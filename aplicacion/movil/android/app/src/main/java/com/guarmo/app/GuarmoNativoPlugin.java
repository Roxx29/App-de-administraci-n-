package com.guarmo.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Funciones nativas de Guarmo:
 *  - Almacén seguro: valores cifrados con una clave AES del Android Keystore (la clave nunca sale del dispositivo).
 *  - Impresión: abre el diálogo de impresión de Android (incluye "Guardar como PDF") con el HTML de la factura.
 */
@CapacitorPlugin(name = "GuarmoNativo")
public class GuarmoNativoPlugin extends Plugin {
    private static final String ALIAS = "guarmo_almacen_seguro";
    private static final String PREFS = "guarmo_seguro";
    private WebView vistaImpresion; // se mantiene viva mientras dura la impresión

    private SecretKey clave() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void guardar(PluginCall call) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, clave());
            byte[] cifrado = c.doFinal(call.getString("valor", "").getBytes(StandardCharsets.UTF_8));
            byte[] todo = ByteBuffer.allocate(c.getIV().length + cifrado.length).put(c.getIV()).put(cifrado).array();
            prefs().edit().putString(call.getString("clave"), Base64.encodeToString(todo, Base64.NO_WRAP)).commit();
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo guardar en el almacén seguro", e);
        }
    }

    @PluginMethod
    public void leer(PluginCall call) {
        JSObject r = new JSObject();
        String guardado = prefs().getString(call.getString("clave"), null);
        if (guardado == null) {
            r.put("valor", null);
            call.resolve(r);
            return;
        }
        try {
            byte[] todo = Base64.decode(guardado, Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, clave(), new GCMParameterSpec(128, todo, 0, 12));
            r.put("valor", new String(c.doFinal(todo, 12, todo.length - 12), StandardCharsets.UTF_8));
        } catch (Exception e) {
            // Valor ilegible (p. ej. la clave del Keystore cambió): se descarta en lugar de bloquear la app.
            prefs().edit().remove(call.getString("clave")).commit();
            r.put("valor", null);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void borrar(PluginCall call) {
        prefs().edit().remove(call.getString("clave")).commit();
        call.resolve();
    }

    @PluginMethod
    public void imprimir(PluginCall call) {
        String html = call.getString("html", "");
        String nombre = call.getString("nombre", "Factura");
        getActivity().runOnUiThread(() -> {
            vistaImpresion = new WebView(getActivity());
            vistaImpresion.getSettings().setJavaScriptEnabled(false);
            vistaImpresion.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView vista, String url) {
                    PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    pm.print(nombre, vista.createPrintDocumentAdapter(nombre),
                            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    call.resolve();
                }
            });
            vistaImpresion.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
