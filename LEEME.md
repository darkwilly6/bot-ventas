# 💬 Bot de Ventas para WhatsApp: guía de instalación

Bot que atiende tu WhatsApp las 24 horas: asesora con tu catálogo, arma el carrito, pide los datos de envío, ofrece **pago completo** (con envío gratis) o **anticipo + contra entrega**, cierra el pedido, recibe el comprobante y te avisa para que lo confirmes. Siempre termina con **dos opciones en botones**.

Todo funciona con planes **gratuitos**: Netlify, Google Gemini, la API oficial de WhatsApp (Meta), GitHub y Resend (este último es opcional).

---

## 📁 Qué trae el zip

| Archivo / carpeta | Para qué sirve |
|---|---|
| `public/` | El panel de administración (lo que ves en el navegador) |
| `netlify/functions/webhook.mjs` | Recibe los mensajes de WhatsApp |
| `netlify/functions/api.mjs` | La API del panel |
| `netlify/lib/` | El cerebro: motor de ventas, IA, catálogo, pedidos y avisos |
| `plantilla-catalogo.xlsx` | Plantilla para llenar tus productos |
| `tests/` | Pruebas automáticas y servidor local (opcional) |

---

## ⚠️ Antes de empezar: cómo subirlo a Netlify

**No sirve arrastrar el zip a Netlify Drop.** Así solo se sube la parte visual, y el bot (las "funciones") no se activaría. Usá una de estas dos opciones, ambas gratis:

### Opción A, recomendada: con GitHub (sin instalar nada)
1. Creá una cuenta en **github.com** y luego un repositorio nuevo (**New repository**), privado, con el nombre `bot-ventas`.
2. Descomprimí el zip en tu computadora.
3. En el repositorio, entrá a **Add file → Upload files** y arrastrá **el contenido** de la carpeta: `public`, `netlify`, `package.json`, `netlify.toml` y lo demás. No subas la carpeta `node_modules` si existe. Al final tocá **Commit changes**.
4. Entrá a **app.netlify.com**, creá tu cuenta y andá a **Add new site → Import an existing project → GitHub**. Elegí tu repositorio y tocá **Deploy** (la configuración ya viene lista en `netlify.toml`).

### Opción B: con la terminal (si tenés Node.js instalado)
Abrí una terminal en la carpeta descomprimida y ejecutá estos comandos, uno por uno:
```bash
npm install
```
```bash
npx netlify-cli login
```
```bash
npx netlify-cli deploy --build --prod
```

---

## 1️⃣ Contraseña del panel (obligatoria)

1. En Netlify, abrí tu sitio y entrá a **Site configuration → Environment variables → Add a variable**.
2. Creá la variable `ADMIN_PASSWORD` y como valor poné una contraseña fuerte, inventada por vos.
3. Andá a **Deploys → Trigger deploy → Deploy site** para que el cambio se aplique.
4. Abrí la URL de tu sitio (por ejemplo `https://tu-bot.netlify.app`) y entrá con esa contraseña.

## 2️⃣ La IA: Gemini (gratis)

1. Entrá a **https://aistudio.google.com/apikey** con tu cuenta de Google y tocá **Create API key**.
2. En el panel: **⚙️ Ajustes → Conexiones → Gemini · API key**. Pegala, guardá y tocá **🧠 Probar IA**.
3. Los límites gratis de Google cambian de vez en cuando. Si en algún momento ves errores de límite:
   - Usá el **modelo de respaldo**, que ya viene configurado como `gemini-2.5-flash-lite`.
   - O agregá también una API key gratis de **Groq** (console.groq.com) como segundo respaldo.

## 3️⃣ Tu negocio, pagos y catálogo

1. En **⚙️ Ajustes** llená:
   - el nombre del negocio, el tono y las políticas;
   - las cuentas bancarias;
   - el anticipo ($5), el costo de envío ($3) y la casilla de envío gratis con pago completo;
   - los datos que el bot debe pedir para el envío;
   - tu WhatsApp personal para recibir avisos.
2. En **🗂️ Catálogo**, descargá la plantilla (o usá `plantilla-catalogo.xlsx`), llenala y subila. Las reglas:
   - Las columnas **Producto** y **Precio** son obligatorias.
   - Cualquier otra columna (Corte, Talla, Color, Estilo…) se convierte en una opción del producto. Por eso sirve para camisas, bolsos o cualquier otro negocio.
   - Si escribís `XS, S, M, L, XL` en una sola celda, se crea una variante por cada talla.
   - En **Stock** podés poner `ilimitado`, `agotado` o un número.
3. Entrá a **🧪 Probar** y chateá con tu bot **antes de conectarlo a WhatsApp**: escribí "hola" y hacé un pedido completo. Los pedidos de prueba aparecen en **Pedidos → 🧪 Pruebas**, y desde ahí podés confirmar el pago y ver cómo el bot le avisa al cliente.

## 4️⃣ Conectar WhatsApp (API oficial de Meta)

### Paso 4.1: crear la app en Meta
1. Entrá a **https://developers.facebook.com**, tocá **Mis apps → Crear app** y elegí el tipo **Empresa** (Business). Asociala a tu portfolio comercial de Meta (antes Business Manager).
2. Dentro de la app, agregá el producto **WhatsApp** y entrá a **Configuración de la API** (API Setup).
3. Meta te da un **número de prueba gratis**. Copiá su **Phone Number ID** y pegalo en el panel (**Ajustes → Conexiones**).
4. Agregá tu celular como destinatario de prueba para poder chatear con el bot desde ya.

### Paso 4.2: token permanente (para que no caduque cada 24 h)
1. Entrá a **business.facebook.com → Configuración → Usuarios del sistema → Agregar**, con rol Administrador.
2. Asignale la app y tu cuenta de WhatsApp con control total.
3. Tocá **Generar token**, elegí tu app y marcá los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Elegí que **nunca caduque**.
4. Pegá ese token en **Ajustes → WhatsApp · Token de acceso**.

### Paso 4.3: el webhook (para que los mensajes lleguen al bot)
1. En el panel, inventá un **token de verificación** (por ejemplo `nyxar-secreto-2026`) y guardá.
2. En Meta, entrá a **WhatsApp → Configuración → Webhook → Editar** y llená:
   - **URL de devolución de llamada:** la que aparece en **🏠 Inicio** del panel (`https://tu-bot.netlify.app/webhook`).
   - **Token de verificación:** el mismo que inventaste.
3. Tocá **Verificar y guardar**. Después, en **Campos del webhook**, suscribite a `messages`. Si usás coexistencia, suscribite también a `smb_message_echoes`.
4. Opcional, para más seguridad: copiá la **Clave secreta de la app** (Configuración → Básica) y pegala en **App Secret**.
5. Escribile "hola" al número desde tu celular. 🎉

### Paso 4.4: tu número real de WhatsApp Business

Aquí hay **tres caminos**:

| Camino | Costo | Ventaja | Detalle |
|---|---|---|---|
| **A. Número nuevo dedicado** (chip aparte) | Solo el chip | Directo, 100 % bajo tu control | Lo agregás en **API Setup → Agregar número de teléfono**. Ese número ya no se puede usar en la app de WhatsApp. |
| **B. Migrar tu número actual a la API** | $0 | Conservás tu número | Primero hay que **eliminar la cuenta en la app** WhatsApp Business. Después ya no podés usar la app con ese número, solo el panel. |
| **C. Coexistencia** (app y bot en el mismo número) | Variable | Seguís usando la app en tu celular | Meta lo habilita mediante su flujo *Embedded Signup*, normalmente a través de un proveedor oficial (BSP) o siendo *Tech Provider* (requiere verificar el negocio). El bot ya está preparado: si respondés desde la app, se calla en ese chat. |

**Recomendación para empezar gratis:**
1. Probá todo con el **número de prueba** de Meta.
2. Cuando estés listo, usá un **chip nuevo** (camino A) para el bot, y anunciá ese número como tu "WhatsApp de ventas".

### 💲 Costos de WhatsApp
- Responder a un cliente que te escribió es **gratis** durante 24 horas desde su último mensaje.
- El bot solo responde, nunca escribe en frío, así que el uso normal es gratis.
- Si un cliente no escribe en más de 24 h, WhatsApp no deja mandarle mensajes libres. En ese caso:
  - el panel muestra el error;
  - podés escribirle desde tu teléfono.

## 5️⃣ Avisos para vos

- **En el panel:** la campanita 🔔. Tocá "Activar alertas del navegador" en Inicio para recibir además sonido y notificación.
- **En tu WhatsApp personal** (un número distinto al del negocio): escribile "hola" al número del bot desde tu personal. Eso abre una ventana gratis de 24 h en la que te llegan los avisos.
  - Te llegan con botones **✅ Confirmar pago / ❌ Rechazar**.
  - También acepta comandos: `pedidos`, `confirmar NX-AB12C`, `enviado NX-AB12C`, `pausar 50370000000`.
- **Por correo** (respaldo opcional):
  1. Creá una cuenta gratis en **resend.com** con el correo donde querés recibir los avisos.
  2. Generá una API key y pegala en Ajustes.
  3. Poné ese mismo correo en "Correo para avisos".

## 🧭 Cómo trabaja el bot

1. **Saludo**, y luego muestra categorías o productos con lista y botones.
2. **Elección de opciones.** Pregunta lo que falte (corte, talla, color) y no ofrece lo agotado.
3. **Datos de envío:** nombre y apellido, teléfono, departamento, municipio, dirección exacta, referencia y un comentario opcional.
4. **Forma de pago** (doble alternativa). Con un producto de $25:
   - 💳 **Pago completo:** $25, con envío gratis.
   - 💵 **Anticipo:** $5 ahora y $23 contra entrega (total $28, envío incluido).
5. **Resumen** con los botones ✅ Confirmar / ✏️ Modificar.
6. **Pedido creado.** Le envía tus cuentas bancarias y le pide el comprobante.
7. **Comprobante.** El bot lo lee con IA (monto, banco, referencia), marca el pedido como **💰 Pago por verificar** y te avisa.
8. **Vos confirmás.** Lo hacés en el panel o con el botón de WhatsApp. El cliente recibe la confirmación y el stock se descuenta.
9. **Envío.** En **Pedidos** imprimís la **🏷️ etiqueta de envío** (10×15 cm, con el monto a cobrar contra entrega). Luego marcás "Enviado" y "Entregado", y el bot le avisa al cliente en cada paso.

**Etiquetas automáticas de cada chat:** 🆕 Nuevo · 💬 Consultando · 🛒 Interesado · 📝 Cerrando pedido · ⏳ Esperando pago · 💰 Pago por verificar · ✅ Confirmado · 🚚 Enviado · 🆘 Necesita ayuda. Además podés crear etiquetas propias (VIP, Mayorista…).

> Las etiquetas de la app WhatsApp Business no se pueden manejar desde la API oficial. Por eso viven en el panel.

**Paso a un humano:** cuando el cliente pide un asesor, tiene un reclamo o pide precio por mayoreo, el bot:
1. te avisa;
2. se pausa en ese chat (6 h, configurable).

Vos respondés desde el panel y, cuando terminás, tocás **✔ Resuelto** para reactivar el bot.

## 🧪 Probarlo en tu computadora (opcional)

```bash
npm install
```
```bash
npm test
```
```bash
node tests/dev-server.mjs
```

El último comando abre el panel en http://localhost:8888 (contraseña `test`), con una IA simulada.

## ❓ Problemas comunes

| Problema | Solución |
|---|---|
| "Falta configurar ADMIN_PASSWORD" | Creá la variable en Netlify y volvé a desplegar (paso 1). |
| Meta no verifica el webhook | El token de verificación debe ser idéntico en Meta y en el panel. Guardá los Ajustes antes de verificar. |
| El bot no responde en WhatsApp | Revisá que estés suscrito a `messages`, que el token sea permanente y la campanita 🔔 por si hay errores. |
| "La IA no respondió" | Revisá la API key de Gemini con **🧠 Probar IA**. Si es por límite, agregá una key de Groq o cambiá el modelo. |
| No me llegan avisos a mi WhatsApp | Escribile "hola" al bot desde tu número personal (abre la ventana de 24 h) o activá los avisos por correo. |
