# Smart Home IoT System

Sistema de automatización y monitoreo de un hogar inteligente con sensores, comunicación IoT e interfaz web en tiempo real.

## Estructura del proyecto

```text
smart-home-iot-system/
├── .gitignore
├── README.md
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── style.css
└── hardware/
    ├── arduino_uno/
    │   └── arduino_uno.ino
    └── esp8266/
        └── esp8266_gateway.ino
```

## ¿Para qué sirve cada archivo?

### README.md
Archivo principal de documentación del proyecto. Aquí se explica la idea general del sistema, su estructura y cómo se organiza el repositorio.

### .gitignore
Define qué archivos no deben subirse al repositorio Git, como credenciales, variables de entorno y archivos temporales.

### backend/
Carpeta del servidor principal del sistema.

- backend/package.json
  Contiene la configuración del proyecto Node.js, dependencias y scripts para iniciar el backend.

- backend/package-lock.json
  Archivo generado automáticamente por npm para bloquear versiones exactas de las dependencias y asegurar compatibilidad.

- backend/.env
  Guarda variables de entorno privadas como credenciales de Supabase, MQTT y configuración del servidor. No suele subirse al repositorio.

- backend/.env.example
  Plantilla de ejemplo para configurar las variables de entorno sin exponer secretos reales.

- backend/server.js
  Es el corazón del backend. Aquí se configura Express, Socket.IO, MQTT y la conexión con Supabase. También recibe datos de sensores, actualiza el historial y expone la interfaz web.

### frontend/
Carpeta de la interfaz del usuario.

- frontend/index.html
  Estructura principal de la página web del dashboard de Smart Home.

- frontend/style.css
  Contiene los estilos visuales de la interfaz: colores, diseño, tarjetas, indicadores y responsividad.

- frontend/app.js
  Lógica del frontend. Se conecta con Socket.IO, recibe datos en tiempo real y actualiza los valores de temperatura, humedad e iluminación en el dashboard.

### hardware/
Carpeta donde están los dispositivos físicos y su programación.

- hardware/arduino_uno/arduino_uno.ino
  Código del Arduino Uno. Aquí se leen sensores como temperatura, humedad, vibración, flama, sonido, puerta y control de alertas visuales/sonoras.

- hardware/esp8266/esp8266_gateway.ino
  Código del ESP8266, que actúa como gateway. Conecta el Arduino con Wi‑Fi y MQTT, reenvía comandos de luz y publica eventos a HiveMQ o a la nube.

## Resumen general

El proyecto está dividido en tres capas:

- Backend: procesa los datos, se conecta con MQTT y Supabase, y sirve la aplicación web.
- Frontend: muestra los datos en tiempo real a través de un dashboard.
- Hardware: incluye los sensores y microcontroladores encargados de detectar eventos y enviar información.

Esto permite un sistema IoT completo donde los dispositivos físicos, el servidor y la interfaz visual trabajan juntos para monitorear y controlar una casa inteligente.
