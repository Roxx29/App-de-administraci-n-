package com.apexledger.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApexNativoPlugin.class);
        super.onCreate(savedInstanceState);
        // Sin capturas de pantalla ni vista previa en "apps recientes": la app muestra datos del negocio.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
