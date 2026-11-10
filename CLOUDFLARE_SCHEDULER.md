# Programador de Bitcoin Hoy con Cloudflare Workers Free

## Diseño

- Cloudflare ejecuta un único Worker con dos expresiones Cron que producen seis ejecuciones diarias.
- El Worker solo valida su configuración, registra la ejecución y hace un único `POST` autenticado a Vercel. No consulta proveedores, no llama a Groq y no guarda datos.
- Vercel mantiene Next.js, Neon/PostgreSQL y la generación editorial con Groq.
- La página y `GET /api/daily` solo leen datos guardados. La única ruta que recolecta datos y puede llamar a Groq es `POST /api/internal/daily-update`. El gráfico de BTC usa la serie histórica de precios guardada en Neon; no carga TradingView ni imágenes remotas al visitar la página. Los enlaces a notas solo navegan a la fuente si el visitante los abre. La serie histórica se incorpora en una actualización programada completa.
- `job_executions` registra cada slot programado y usa una reserva única por horario más un bloqueo global atómico. Un slot ya reservado nunca vuelve a consumir una llamada a Groq, aunque la primera ejecución haya fallado o se haya interrumpido.
- Las ediciones y snapshots se escriben en una transacción y solo después de pasar las comprobaciones de integridad. Una falla o fuente requerida incompleta no reemplaza la última edición válida.

## Horarios fijos de Argentina

Argentina permanece en UTC−3 todo el año. Cloudflare interpreta los Cron Triggers en UTC:

| Argentina (UTC−3) | UTC | Expresión que lo incluye |
| --- | --- | --- |
| 06:00 | 09:00 | `0 9,13,17,21 * * *` |
| 10:00 | 13:00 | `0 9,13,17,21 * * *` |
| 14:00 | 17:00 | `0 9,13,17,21 * * *` |
| 16:30 | 19:30 | `30 19,23 * * *` |
| 18:00 | 21:00 | `0 9,13,17,21 * * *` |
| 20:30 | 23:30 | `30 19,23 * * *` |

Las dos expresiones contienen seis combinaciones en total. No se aplican conversiones estacionales a Argentina.

La referencia de Nueva York sí cambia: la apertura de las 09:30 ET corresponde a las 10:30 en Argentina durante el horario de verano estadounidense (EDT, UTC−4) y a las 11:30 durante el horario estándar (EST, UTC−5). El cierre/ventana diaria de referencia de ETF de las 16:00 ET corresponde a las 17:00 o 18:00 de Argentina, respectivamente. Por eso los cron argentinos permanecen fijos y no siempre coinciden con la misma hora de Nueva York.

## Límites de los planes gratuitos

Verificado en la documentación oficial de Cloudflare (consultada el 10 de noviembre de 2026): Workers Free permite 5 Cron Triggers por cuenta, 100.000 solicitudes al día, 10 ms de CPU por Cron Trigger y hasta 15 minutos de duración de pared. Esta configuración ocupa **2 de 5 triggers**, genera **6 invocaciones y 6 solicitudes HTTP al día**, y no usa otros servicios de Cloudflare.

El Worker ejecuta solo validaciones pequeñas, serializa un JSON pequeño, hace un `fetch` y registra un resumen; la espera de red no consume CPU. Por diseño cabe holgadamente en 10 ms de CPU. Una vez desplegado, confirme el uso observado en Workers & Pages → Worker → Metrics/Logs. No se puede medir el CPU real de producción antes de desplegarlo.

Vercel Hobby limita sus propios Cron Jobs a una ejecución diaria, por eso se eliminó el Cron de Vercel. La ruta de actualización fija `maxDuration = 120` segundos, por debajo del máximo de 300 segundos de una función Hobby con Fluid Compute. La llamada del Worker espera la respuesta de Vercel y vence a los 150 segundos; la ejecución completa de Cloudflare Cron tiene margen de 15 minutos.

## Variables y secretos

Configure solo en los paneles de despliegue, nunca en el repositorio ni en el frontend:

| Servicio | Variable | Tipo | Uso |
| --- | --- | --- | --- |
| Vercel, entorno Production | `DAILY_UPDATE_SECRET` | Secreto | Autentica la ruta privada. |
| Cloudflare Worker | `VERCEL_DAILY_UPDATE_TOKEN` | Secreto | Bearer enviado a Vercel. Debe tener exactamente el mismo valor aleatorio que `DAILY_UPDATE_SECRET`. |
| Cloudflare Worker | `VERCEL_UPDATE_URL` | Texto, no secreto | URL HTTPS canónica de producción terminada en `/api/internal/daily-update`. |
| Vercel | `DATABASE_URL` | Secreto ya conectado | Neon/PostgreSQL existente. |
| Vercel | `GROQ_API_KEY` | Secreto ya conectado | Integración actual; no se traslada a Cloudflare. |

Use un valor aleatorio de al menos 32 bytes para el par de variables de autenticación. No reutilice `GROQ_API_KEY`, `DATABASE_URL` ni otros tokens. No lo envíe por chat. `VERCEL_UPDATE_URL` debe usar el dominio de producción estable, no un Preview Deployment.

## Configuración manual necesaria

La conexión de cuenta, los secretos y el dominio de producción requieren acceso a los paneles de Vercel y Cloudflare; no se completan desde este repositorio.

1. **Vercel → Settings → Environment Variables:** agregue `DAILY_UPDATE_SECRET` solo a Production. Mantenga `DATABASE_URL` y `GROQ_API_KEY` como están. No cree un Cron Job de Vercel.
2. **Despliegue de Vercel:** publique el código de la rama de esta implementación. Compruebe que `POST /api/internal/daily-update` sin Bearer devuelve `401` y que una petición `GET` a esa ruta no inicia una actualización.
3. **Cloudflare → Workers & Pages:** cree el Worker `bitcoin-hoy-scheduler` usando la configuración `cloudflare/wrangler.toml` (puede conectar el repositorio o desplegar desde un entorno local con Wrangler). En el Worker, abra Settings → Variables and Secrets y establezca `VERCEL_UPDATE_URL` con el dominio canónico de producción y `VERCEL_DAILY_UPDATE_TOKEN` como secreto con el mismo valor de `DAILY_UPDATE_SECRET`. `keep_vars = true` conserva estas variables del panel al desplegar.
4. Si despliega desde un entorno local con el repositorio, autentique Wrangler con su cuenta y despliegue usando `pnpm dlx wrangler@latest deploy --config cloudflare/wrangler.toml`; para crear/actualizar el secreto use `pnpm dlx wrangler@latest secret put VERCEL_DAILY_UPDATE_TOKEN --config cloudflare/wrangler.toml`. No ejecute esos comandos en la vista previa de v0. También puede crear el Worker desde Cloudflare y cargar allí las variables antes de habilitar los Cron Triggers.
5. Revise Settings → Triggers → Cron Triggers: deben aparecer `0 9,13,17,21 * * *` y `30 19,23 * * *`. Cloudflare puede tardar hasta 15 minutos en propagar cambios de cron.
6. Espere una sola ejecución programada para la prueba de extremo a extremo. No dispare seis pruebas. En Cloudflare Logs confirme HTTP 200/202; en Vercel Function Logs y la tabla `job_executions` confirme `completed`, horario, fuentes, errores y uso de tokens; en `GET /api/daily` y la página pública confirme que aparece la edición nueva. En Network al abrir la página no deben aparecer solicitudes a Groq, CoinGecko, Xoomar, Alternative.me, RSS, TradingView ni servidores de imágenes; el gráfico usa la serie de precio guardada.
7. Para comprobar idempotencia sin consumir otra llamada, una segunda entrega del mismo `scheduledTime` debe responder `202` como duplicada y no invocar proveedores ni Groq. Una ejecución parcial debe quedar registrada como `partial` y conservar la edición anterior.

## Validación técnica del código

El repositorio incluye el Worker en `cloudflare/src/index.ts` y su configuración en `cloudflare/wrangler.toml`. El validador del endpoint acepta únicamente las dos expresiones cron y una hora programada que coincida con ellas. La reserva del slot es persistente y única; el bloqueo global evita ejecuciones simultáneas de distintos slots. La ruta nunca acepta `GET` y valida el secreto antes de leer el cuerpo o acceder a la base.

Fuentes oficiales consultadas:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Vercel Function duration: https://vercel.com/docs/functions/configuring-functions/duration
- Vercel Cron pricing and Hobby restrictions: https://vercel.com/docs/cron-jobs/usage-and-pricing
