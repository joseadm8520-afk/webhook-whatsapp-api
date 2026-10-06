# Webhook de WhatsApp Cloud API

Servidor HTTP para la verificación y recepción de eventos de WhatsApp Cloud API.
La ruta del webhook es `/webhook`; `/health` sirve para comprobar el estado del servicio.

## Desplegar en Render

1. Sube este proyecto a la rama principal del repositorio `webhook-whatsapp-api`.
2. En Render, crea un **Blueprint** y conecta ese repositorio. Render detectará `render.yaml`.
3. En la configuración del servicio, define `VERIFY_TOKEN` con una cadena larga y aleatoria.
4. Define `APP_SECRET` con el **App Secret** de tu aplicación de Meta (Meta for Developers → App settings → Basic).
5. Define `MAKE_WEBHOOK_URL` con la URL del webhook personalizado creado en Make. Consérvala como dato secreto.
6. Cuando el servicio termine de desplegarse, copia su URL HTTPS pública, por ejemplo:
   `https://webhook-whatsapp-api.onrender.com`

La **Callback URL** que debes registrar en Meta será esa URL más `/webhook`, por ejemplo:
`https://webhook-whatsapp-api.onrender.com/webhook`

En Meta for Developers → WhatsApp → Configuration, pega esa Callback URL y usa como
**Verify token** exactamente el mismo valor configurado como `VERIFY_TOKEN`. Completa la
verificación y suscribe el webhook al campo `messages`.

No se puede saber la URL pública final hasta que Render cree el servicio. No pongas
`/health` como Callback URL; esa ruta es solo para comprobar que el servicio está activo.

## Probar localmente

Requiere Node.js 20 o posterior:

```powershell
Copy-Item .env.example .env
# Edita .env y define VERIFY_TOKEN y APP_SECRET.
npm test
npm start
```

La verificación de Meta usa `GET /webhook` con los parámetros `hub.*`. Los eventos se
reciben por `POST /webhook` y se valida su firma `X-Hub-Signature-256` con `APP_SECRET`.
Los mensajes entrantes se reenvían individualmente a Make como JSON con los campos
`from`, `messageId`, `type` y `text`; las notificaciones de estado no se reenvían. Si Make
no está configurado o no acepta la solicitud, el servicio responde con error para que Meta
pueda reintentar. El servicio no registra el contenido de los mensajes ni los números de
teléfono. No publiques `.env` ni compartas sus secretos.
