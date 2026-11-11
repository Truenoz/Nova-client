# Nova Client

Launcher de Minecraft: Java Edition para Windows, hecho con Electron.

## Qué hace

- Inicio de sesión con cuenta Microsoft (se recuerda la sesión, guardada cifrada con DPAPI).
- **Modo sin cuenta (offline)**: permite elegir un nombre local para jugar en un jugador o en servidores que acepten autenticación offline. No valida cuentas, no da acceso a servidores premium y no permite suplantar cuentas.
- Lista de versiones oficiales de Mojang (releases y, opcionalmente, snapshots), desde la 1.19 hasta las más nuevas.
- Descarga el juego, librerías y recursos la primera vez.
- Descarga e instala automáticamente el Java correcto para cada versión (Java 8, 17 o 21), sin que tengas que instalar nada.
- RAM configurable, ruta de Java opcional, registro del juego en vivo.
- **Nova Client**: un mod de Fabric propio que se instala solo y agrega, dentro de Minecraft, un HUD y pantallas propias de título, pausa y amigos con el mismo estilo del launcher (ver abajo).
- **Discord**: mientras jugás, tu perfil muestra «Jugando Nova Client» con la versión y el tiempo (ver sección Discord).
- **Actualizaciones en vivo**: el launcher se actualiza solo y Nova Client se descarga nuevo sin reinstalar nada (ver sección Actualizaciones).

## Skin en 3D

En Inicio, el personaje es un modelo 3D (WebGL, sin librerías) con la **skin real de la cuenta**: se detecta sola al iniciar sesión, incluyendo skins finas (Alex), viejas de 64×32, HD y la capa exterior. Se gira arrastrando, la cabeza sigue al mouse y doble clic lo devuelve al frente. La carita del chip de cuenta sale de la misma skin. Sin sesión se muestra Steve en gris.

- `skins.js` (proceso principal) baja la skin por UUID o nombre de **cualquier jugador** (sesión → Mojang → mc-heads.net → última guardada en disco) y solo acepta PNG de `textures.minecraft.net` / `mc-heads.net`.
- `renderer/skin3d.js` dibuja el modelo. Si el equipo no soporta WebGL queda la imagen 2D de antes.
- Desde la interfaz: `launcher.getMySkin()` y `launcher.getSkin('nombre o uuid')`.

## Novedades de la 1.1

- **Perfiles**: cada perfil es una instalación aparte (versión, cargador, mods, mundos y config propios). Pantalla *Perfiles* con carpetas, fijados, búsqueda, menú contextual (editar, duplicar, copiar de otro perfil, exportar, compartir, eliminar).
- **Detalle de perfil**: pestañas Contenido / Mundos / Registros / Ajustes / Compartir, lista de mods con activar, actualizar y eliminar, y buscador de Modrinth (con dependencias).
- **Rendimiento**: interruptor que instala Sodium, ImmediatelyFast, Entity Culling, Lithium, FerriteCore y ModernFix en el perfil.
- **Selector de cargador** al crear / cambiar versión (Fabric disponible; NeoForge y Forge todavía no).
- **Servidores** guardados con entrada directa, **Configuración** completa (idioma, abrir con Windows, DiscordRPC, apariencia, Java y memoria, ventana del juego, zona de peligro) y *Exportar depuración*.
- Dentro del juego: HUD con módulos (FPS, CPS, teclas, armadura, efectos de poción, info del ítem, estado de sprint, velocidad, servidor, tiempo de sesión), pantalla de título y pausa propias, y amigos con chat.

## Versiones disponibles

El launcher solo deja elegir y descargar: 1.19.2, 1.19.3, 1.19.4, 1.20.1 – 1.20.6, 1.21 – 1.21.8, 1.21.10, 1.21.11, 26.1, 26.1.1, 26.1.2, 26.2 y 26.3 (`ALLOWED_VERSIONS` en `main.js`, igual que `client-mod/versions.txt`). No hay snapshots ni otras versiones.

## Box Client + pantallas de Nova (Minecraft 1.19.2 – 1.21.11)

Desde 1.19.1 hasta 1.21.11 el jar combina dos cosas (época `boxnova` en `client-mod/versions.txt`):

- **Box Client v3.0.4 completo** (paquete `com.boxclient`): menú de mods, módulos, efectos, perfiles, galería, Spotify. Está en nombres *intermediary*; `scripts/remap-box.js` lo pasa a Yarn antes de compilar (`client-mod/.box-yarn/`). Su menú se abre con su propia tecla (Controles → Box Client). De dónde sale su código:
  - **1.19 – 1.21.5**: un código por rango en `client-mod/src/boxold/<rango>/` (`java/` y `resources/`), tomado del Box Client de esa versión; `common/resources/fabric.mod.json` es el de todos. Rangos: 1.19.1–1.19.2, 1.19.3–1.19.4, 1.20–1.20.1, 1.20.2–1.20.4, 1.20.5–1.20.6, 1.21–1.21.1, 1.21.2–1.21.4 y 1.21.5 (tabla `BOX_TREES` en `scripts/eras.js`).
  - **1.21.6 – 1.21.8**: `client-mod/src/box/`.
  - **1.21.10 y 1.21.11**: `boxold/1_21_10` y `boxold/1_21_11`.
- **Interfaz de Nova Client dentro de Minecraft**: pantalla de título, menú de pausa y panel **Social / Amigos** (`BaseTitleScreen`, `BasePauseScreen`, `ChatPanel`, `NovaNet`…, en `src/main`). Dibujan con `MatrixStack` en 1.19.x (`src/matrix`, más `src/matrix-item-old|new` según la versión) y con `DrawContext` desde 1.20 (`src/draw`); desde 1.21.9 la entrada cambia (`Click`, `KeyInput`, `CharInput`) y las tres `NovaXxxScreen` salen de `src/draw9`, escritas en intermediary y pasadas a Yarn por `remap-box.js` junto con Box. `build.gradle` elige la capa solo según la versión. La lógica de entrada vive en `Base*Screen` (`novaClick`, `novaKey`, `novaChar`) y cada capa solo la conecta con la firma de Minecraft; `ProfileCompat` lee id y nombre del `GameProfile` en cualquier versión (en 1.21.9+ es un record). Los módulos y el HUD de Nova **no** se compilan en esta época (los da Box); el `NovaClient` de `client-mod/src/boxnova/` solo registra las pantallas y los avisos de amigos. El `fabric.mod.json` y el mixin de la pantalla de carga (`src/boxnova/resources/`) son compartidos y toman el nivel de Java de cada versión.

Para volver a las pantallas de Minecraft: archivos vacíos `novaclient-sin-titulo.txt` / `novaclient-sin-pausa.txt` en la carpeta `config`. El jar se sigue llamando `nova-client-<versión>.jar`. La época `boxold` (solo Box, sin pantallas de Nova) sigue disponible: se pide a mano en `versions.txt`. Compilar: `npm run build:mod -- --only 1.20.1 --force`.

**Sin 1.21.9:** se quitó porque su Fabric API (0.134.1) no trae `WorldRenderEvents`/`WorldRenderContext`, que Box usa para el aura, los números de daño, los efectos y la letra de canciones.

**Sin probar:** las pantallas de Nova sobre 1.19 – 1.19.3 (antes solo estaban probadas en 1.19.4), sobre el Box de 1.19 – 1.21.5 y sobre 1.21.10 – 1.21.11 se verificaron leyendo el código, no compilando; si alguna versión falla, mirá el error de Gradle y avisá.

## Minecraft 26.1 – 26.3 (época `box26`, solo Box Client)

26.x viene sin ofuscar y con los nombres de Mojang (Yarn ya no existe), y pide Java 25. Por eso tiene su propio build: `client-mod/build26.gradle` (plugin `net.fabricmc.fabric-loom`, sin línea `mappings`, `implementation` en vez de `modImplementation`, `jar` en vez de `remapJar`); `settings.gradle` lo elige solo con `-Pera=box26`, y `scripts/modbuild.js` sube el wrapper de la copia de trabajo a Gradle 9.2.1. El Box Client de cada versión está tal cual en `client-mod/src/box26/<26_1|26_2|26_3>/` (26.1.2 → `26_1`), sin remapear.

**Las pantallas de Nova (título, pausa, amigos) todavía no están en 26.x**: están escritas con nombres Yarn y la API de dibujo de 26.x cambió (`GuiGraphicsExtractor`), así que hay que portarlas a los nombres de Mojang con el compilador a mano. Compilar: `npm run build:mod -- --only 26.2 --force` (necesita JDK 25).

## Nova Client (dentro del juego)

Disponible en Minecraft **1.19.1 – 1.21.11 (sin 1.21.9)** con pantallas de Nova, y **26.1 – 26.3** solo con Box Client (ver más abajo) (lista en `client-mod/versions.txt`). En las demás versiones se juega Minecraft normal. El launcher instala Fabric, Fabric API y el mod automáticamente al darle JUGAR (se puede apagar en Ajustes).

- Si desactivás las pantallas propias (archivos `novaclient-sin-titulo.txt` / `novaclient-sin-pausa.txt`), queda un cartel de marca arriba a la izquierda en el título y la pausa de Minecraft.
- **Pantalla de título propia**: reemplaza la de Minecraft (logo NOVA, Un jugador / Multijugador / Opciones / Salir, cuenta y accesos arriba a la derecha, y una tarjeta de novedades que rota sola). El título de la ventana pasa a ser «Nova Client 1.21.4» (con la versión de Minecraft que se esté jugando). El botón de chat de la barra de arriba abre el menú **Social** (ver más abajo). La cuenta muestra la cara de tu skin real (se baja de Mojang y queda en caché en `config/novaclient/`). Para volver a la pantalla original, creá un archivo vacío `novaclient-sin-titulo.txt` en la carpeta `config` del perfil. El código está en `BaseTitleScreen.java`.
- Al entrar a un mundo aparece unos segundos el cartel «NOVA CLIENT activo». **Si no ves ese cartel ni el cartel de marca, el mod no se cargó** (ver «Si no aparece Nova Client»).
- **No hay menú de mods dentro del juego**: los módulos se activan, se mueven y se ajustan editando `config/novaclient.json` en la carpeta del perfil (con el juego cerrado). El archivo se crea solo la primera vez que abrís el juego, con cada módulo (`enabled`, posición `x` / `y` y sus `settings`).

### Pausa de Nova Client

Al apretar Esc dentro de un mundo aparece una pausa propia (logo, **Volver al juego**, **AMIGOS**, **Opciones** y **Desconectarse** / **Guardar y salir**), con tu cuenta y accesos (amigos, capturas) arriba a la derecha, y **Progresos / Estadísticas / Denunciar jugador (o Abrir a LAN) / Carpeta Minecraft** abajo. Las acciones de Minecraft las hacen los botones originales de la pausa (escondidos), así que funciona igual en todas las versiones. Para volver a la pausa de Minecraft: archivo vacío `novaclient-sin-pausa.txt` en la carpeta `config` del perfil.

### Social, amigos y solicitudes (Nova Net)

El menú **Social** se abre desde la pausa (botón AMIGOS) y desde la pantalla de título (ícono de chat): una ventana centrada con tus charlas y, pegada a la derecha, la barra de amigos con las pestañas **Amigos** y **Pendientes** (En juego / En línea / Desconectado, con secciones que se pliegan).

- Para mandar una **solicitud de amistad**, escribí el nombre en «Buscar amigos / jugadores» y tocá «Enviar solicitud a …» (o Enter). Solo se puede a jugadores que ya usaron Nova Client.
- En **Pendientes** aparecen las solicitudes recibidas (✓ aceptar, ✕ rechazar) y las enviadas (✕ cancelar). Si los dos se piden amistad quedan amigos al instante.
- Sobre un amigo: ícono de chat para escribirle y ✕ para eliminarlo (se confirma con un segundo toque). Los mensajes llegan aunque el amigo esté desconectado (el servidor los guarda 7 días).
- Un aviso arriba en pantalla te dice cuando llega una solicitud o un mensaje, y un contador naranja en AMIGOS / en el ícono de chat.
- **Logo de Nova**: quien juega con Nova Client muestra un logito (la luna con estrellas del logo) delante del nombre en la lista TAB y sobre la cabeza. Se ve entre jugadores con Nova Client en el mismo servidor. El logo es `assets/novaclient/textures/font/badge.png` (8×8); se puede cambiar por otro del mismo tamaño.

Todo esto necesita el servidor **Nova Net** (carpeta `server/`). Sin servidor el juego funciona igual, solo que sin amigos ni logos de otros jugadores.

#### Poner en marcha Nova Net

1. En una máquina que quede encendida (un VPS, Render, Railway, Fly… o tu PC para probar) con Node 18+: `node server/server.js` (o `npm run server`). Puerto por defecto 8787 (`PORT`). Los datos quedan en `server/data/novanet.json` (`NOVANET_DATA` para cambiarlo). Detrás de un proxy (nginx, Render…) poné `TRUST_PROXY=1`.
2. Ponelo con HTTPS y copiá la URL en `nova.config.json` → `"novaNetUrl": "https://tu-servidor"` (o en Ajustes → `novaNetUrl` de `settings.json`). El launcher se la pasa al juego con `-Dnovaclient.net=…`. A mano también sirve `config/novaclient/network.json` → `{"url": "https://tu-servidor"}`.
3. Probar el servidor: `npm run test:server` (usa un modo de desarrollo que no consulta a Mojang; `NOVANET_DEV_AUTH=1` **nunca** en producción).

Seguridad: la cuenta se verifica con el protocolo de sesión de Mojang (`join` / `hasJoined`); el token de Minecraft solo viaja a Mojang, nunca a Nova Net, y no se piden contraseñas. El servidor limita los pedidos por IP y por cuenta.

### Módulos

| Módulo | Qué hace |
|---|---|
| FPS, CPS, Ping, Coordenadas, Dirección, Memoria, Reloj | Datos en pantalla |
| Teclas | W A S D, espacio y clics con CPS |
| Armadura | Piezas equipadas con durabilidad |
| Brillo máximo | Ver de noche (efecto solo visual, local) |
| Zoom | Mantené **C** |
| Sprint automático | Corre solo mientras avanzás |

**Jar de Nova Client por versión (1.19 → 1.21.x):** el launcher ya **no compila nada** en la PC del usuario. Vos generás los `.jar` en tu PC y el launcher baja el de la versión que elija el usuario. Al darle JUGAR (`modmanager.js`): (1) usa el jar que trae el instalador (carpeta `mod/`) o uno ya bajado; (2) si no hay, baja `nova-client-<versión>.jar` del release `mods-rolling` de tu repo de GitHub; (3) si tampoco está publicado, el juego arranca igual solo con Fabric y el motivo queda en el Registro.

**Flujo para sumar una versión:**

```bash
npm run build:mod -- --only 1.21.4   # compila en tu PC → mod/nova-client-1.21.4.jar
npm run build:mod                    # o todas las de client-mod/versions.txt
npm run publish:mods                 # sube todos los de mod/ al release «mods-rolling»
npm run publish:mods -- 1.21.4       # o solo esa versión
```

`publish:mods` necesita [GitHub CLI](https://cli.github.com) con la sesión iniciada (`gh auth login`). Si querés que algunas versiones vengan dentro del instalador (sin descarga), dejá sus jars en `mod/` antes de `npm run build`.

`client-mod/versions.txt` es la lista de versiones que compila `npm run build:mod` sin `--only`; sirve también para fijar la época a mano. Si una versión nueva cambia la API de Minecraft hay que crear una época nueva en `client-mod/src/<época>/java` (son los archivos de `client-mod/src/draw/java`: `Gfx`, `HudHook`, `ScreenHook` y las pantallas de título, pausa y amigos).

**Sin probar (se intenta compilar igual):** 1.19.1–1.19.3 y 1.20.0 (1.19.0 no tiene Box Client); pueden fallar si Mojang cambió la API.
**Imposible con el código actual:** Minecraft 26.x con las pantallas de Nova (hay que portarlas a los nombres de Mojang; hoy 26.x lleva solo Box Client), y 1.8.9/Forge.

Para agregar un módulo nuevo: creá una clase que extienda `Module` en `client-mod/src/main/java/com/novalauncher/client/` y sumala a la lista en `Modules.java`.

### Si no aparece Nova Client

1. En el launcher, Ajustes → «Jugar con Nova Client» tiene que estar activado, y debajo no puede decir que falta compilar el mod. En la tarjeta de perfil tiene que decir «Nova Client» (no «Vanilla»).
2. La versión de Minecraft tiene que estar en la lista de arriba. En 1.8.9 se juega Minecraft normal.
3. El jar de esa versión tiene que existir: en el `.exe` se baja del release `mods-rolling` (subilo con `npm run publish:mods`); con `npm start` (modo desarrollo) hay que correr antes `npm run build:mod`.
4. Si igual no aparece, mirá la pestaña **Registro** del launcher: ahí se avisa si el mod no se pudo activar. Dentro del juego, el log de Minecraft tiene que decir `[Nova Client] vX.Y.Z cargado.`

### Compilar el mod

Necesita Java 21 en tu PC. `npm run build` ya no compila los mods: hacelo antes con `npm run build:mod` si querés incluirlos en el instalador. `npm run build:mod -- --force` (necesita internet: busca solo los mappings y la Fabric API de cada versión). Deja un `mod/nova-client-<versión>.jar` por versión; `--only 1.21.4` compila una sola. Si una versión falla, las demás siguen. Para desarrollo con `npm start`, compilá el mod una vez antes.


## Discord («Jugando Nova Client»)

Discord muestra el **nombre de una aplicación suya**, así que hay que crear una (gratis, 1 minuto):

1. Entrá a <https://discord.com/developers/applications> → **New Application** → nombre: **Nova Client** (ese nombre es lo que aparece en «Jugando a …»).
2. En **General Information** copiá el **Application ID**.
3. Pegalo en `nova.config.json` → `"discordClientId": "123456789012345678"` (o en Ajustes de `settings.json`, campo `discordClientId`).
4. Imagen (opcional): en **Rich Presence → Art Assets** subí el logo (`renderer/logo.png`) con el nombre `logo`, esperá unos minutos y poné `"discordLargeImage": "logo"` en `nova.config.json`. Sin eso no se muestra imagen (si la clave no existe en Discord se ve un «?»).

Con Discord abierto, al apretar JUGAR tu perfil pasa a «Jugando Nova Client · Minecraft 1.21.4 · Jugando con Nova Client» con el tiempo transcurrido, y se limpia al cerrar el juego. Se puede apagar en Ajustes.

## Actualizaciones en vivo

Funciona con **GitHub Releases** (no hay que configurar nada más: el repositorio se detecta solo al compilar).

- **El launcher** se actualiza solo (`electron-updater`): busca al abrir y cada 30 minutos, descarga en segundo plano y muestra arriba un botón «Actualización lista: reiniciar». Solo en la app instalada con el instalador (no en modo desarrollo ni en la versión portable).
- **Nova Client** se actualiza **sin reinstalar nada**: al abrir, cada 30 minutos y justo antes de cada JUGAR, el launcher baja los `nova-client-<versión>.jar` nuevos del último release. También se pueden sumar versiones nuevas de Minecraft así.

Para publicar una actualización:

```bash
git tag v1.0.1
git push origin v1.0.1
```

El workflow compila todo, pone la versión de la etiqueta, crea el release con el instalador y sube los mods. Los usuarios la reciben solos. «Buscar ahora» en Ajustes fuerza la búsqueda.

## Probarlo en desarrollo (Windows)

Requisitos: [Node.js 20+](https://nodejs.org).

```bash
npm install
npm start
```

## Generar el instalador .exe

En una PC con Windows:

```bash
npm install
npm run build
```

El instalador queda en `dist/Nova Client Setup 1.0.0.exe`. Para una versión sin instalación: `npm run build:portable`.

### Sin Windows (GitHub Actions)

1. Subí esta carpeta a un repositorio de GitHub.
2. Entrá a **Actions → Compilar instalador de Windows → Run workflow**.
3. Al terminar, descargá el instalador desde **Artifacts**. Los mods no se compilan ahí: se publican desde tu PC con `npm run publish:mods`.

## Estructura

```
main.js            Proceso principal: login, descargas, lanzamiento del juego
profiles.js        Perfiles, contenido, Modrinth, rendimiento, exportar / importar
util.js            Descargas y utilidades compartidas
discord.js         Discord Rich Presence (IPC, sin dependencias)
updates.js         Descarga de los mods desde GitHub Releases
modmanager.js      Elige el jar según la versión: instalador, caché o descarga
nova.config.json   ID de Discord (y repositorio, si no se detecta solo)
server/            Nova Net: amistades, presencia y mensajes (Node, sin dependencias)
client-mod/        Mod de Fabric "Nova Client" (Java, Gradle)
mod/               Acá quedan los nova-client-<versión>.jar tras compilar el mod (npm run build:mod)
preload.js         Puente seguro entre la interfaz y el proceso principal
renderer/          Interfaz (HTML, CSS, JS)
build/icon.ico     Ícono del instalador
.github/workflows  Compilación automática del .exe
```

## Personalizar

- **Nombre y ID:** `package.json` → `productName`, `build.appId`.
- **Ícono:** reemplazá `build/icon.ico` (256×256 como mínimo).
- **Colores:** variables al inicio de `renderer/styles.css`.
- **Carpeta del juego:** `%APPDATA%\.novalauncher` (se cambia en `main.js`, función `gameDir`).

## Notas

- Necesitás una cuenta de Microsoft que tenga **Minecraft: Java Edition**.
- El instalador sin firma de código puede mostrar la advertencia de SmartScreen de Windows; es normal en apps sin certificado.
- Este launcher descarga el juego desde los servidores oficiales de Mojang y no redistribuye archivos de Minecraft. Minecraft es una marca de Mojang/Microsoft; este proyecto no está afiliado a ellos.
