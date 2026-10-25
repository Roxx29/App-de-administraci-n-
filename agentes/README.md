# Agentes

Equipo de agentes para construir la aplicación desde cero. Cada archivo `.md` es un agente de Claude Code.
La carpeta `.claude/agents` de la raíz apunta aquí, así que Claude Code los detecta automáticamente.

| Agente | Rol |
|---|---|
| `capitan` | Líder: divide el trabajo, asigna y revisa |
| `arquitecto` | Tecnologías y estructura (escritorio → móvil) |
| `diseno` | UX/UI y sistema de diseño |
| `codigo` | Programa la aplicación |
| `base-de-datos` | Modelo de datos, migraciones y consultas |
| `pruebas` | Pruebas automáticas y calidad |
| `seguridad` | Seguridad y privacidad |
| `despliegue` | Compilación, instaladores y CI/CD |

Flujo habitual: `capitan` → `arquitecto` + `diseno` → `base-de-datos` + `codigo` → `pruebas` + `seguridad` → `despliegue`.
