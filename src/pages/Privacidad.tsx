// Aviso de privacidad público (sin sesión). Lo pide Meta para publicar la app de
// WhatsApp Cloud API: https://omm-erp.vercel.app/privacidad
// Si cambia lo que se hace con los datos (WhatsApp, tickets, avisos), se actualiza aquí.

const s = {
  page: { background: '#ffffff', color: '#1f2937', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" } as React.CSSProperties,
  wrap: { maxWidth: 820, margin: '0 auto', padding: '48px 24px 80px', lineHeight: 1.65, fontSize: 15 } as React.CSSProperties,
  h1: { fontSize: 28, margin: '0 0 6px', color: '#111827' } as React.CSSProperties,
  h2: { fontSize: 18, margin: '32px 0 8px', color: '#111827' } as React.CSSProperties,
  muted: { color: '#6b7280', fontSize: 13 } as React.CSSProperties,
}

export default function Privacidad() {
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <h1 style={s.h1}>Aviso de privacidad</h1>
        <div style={s.muted}>OMNIIOUS · OMM Technologies, S.A. de C.V. · Última actualización: 25 de octubre de 2026</div>

        <h2 style={s.h2}>1. Responsable</h2>
        <p>
          OMM Technologies, S.A. de C.V. (marca comercial OMNIIOUS), con RFC OTE210910PW5 y domicilio en la Ciudad de
          México, es responsable del tratamiento de los datos personales que nos proporcionas, conforme a la Ley Federal
          de Protección de Datos Personales en Posesión de los Particulares.
        </p>

        <h2 style={s.h2}>2. Datos que recabamos</h2>
        <ul>
          <li>Nombre y datos de contacto: teléfono, número de WhatsApp y correo electrónico.</li>
          <li>Domicilio o ubicación del inmueble donde prestamos el servicio.</li>
          <li>El contenido de los mensajes, fotografías, videos y documentos que nos envías por WhatsApp u otros medios
            para atender una solicitud.</li>
          <li>Información de los equipos y sistemas instalados en tu inmueble y el historial de servicios.</li>
          <li>Datos fiscales cuando nos solicitas una factura.</li>
        </ul>
        <p>No recabamos datos personales sensibles.</p>

        <h2 style={s.h2}>3. Para qué usamos tus datos</h2>
        <p>Finalidades necesarias para el servicio:</p>
        <ul>
          <li>Recibir, registrar y dar seguimiento a tus reportes de falla y solicitudes de mantenimiento.</li>
          <li>Programar visitas y avisarte por WhatsApp quién te atenderá, cuándo y cuándo va en camino.</li>
          <li>Elaborar cotizaciones, contratos, reportes de servicio y facturas.</li>
          <li>Darte soporte y atender garantías.</li>
        </ul>
        <p>
          Usamos herramientas de inteligencia artificial para clasificar tus mensajes y organizar los reportes. Una persona
          de nuestro equipo da seguimiento a cada solicitud.
        </p>

        <h2 style={s.h2}>4. Con quién compartimos tus datos</h2>
        <p>Solo con proveedores que nos ayudan a prestar el servicio y que actúan por nuestra cuenta:</p>
        <ul>
          <li>Meta Platforms (WhatsApp Business), para enviar y recibir mensajes.</li>
          <li>Proveedores de alojamiento y bases de datos en la nube, donde se guarda la información del servicio.</li>
          <li>Proveedores de inteligencia artificial, para clasificar los mensajes.</li>
          <li>Proveedores de facturación electrónica autorizados por el SAT, cuando solicitas factura.</li>
        </ul>
        <p>No vendemos ni rentamos tus datos personales.</p>

        <h2 style={s.h2}>5. Tus derechos (ARCO) y cómo dejar de recibir mensajes</h2>
        <p>
          Puedes acceder, rectificar, cancelar u oponerte al tratamiento de tus datos, o revocar tu consentimiento,
          escribiendo a <a href="mailto:administracion@omniious.com">administracion@omniious.com</a> con tu nombre, el
          dato o la solicitud y un medio para responderte. Te responderemos en un máximo de 20 días hábiles.
        </p>
        <p>
          Para dejar de recibir avisos por WhatsApp, escríbenos al correo anterior o pídelo en el mismo chat de
          WhatsApp a la persona que te atiende.
        </p>

        <h2 style={s.h2}>6. Conservación</h2>
        <p>
          Conservamos tus datos mientras exista la relación de servicio y durante los plazos que exigen las disposiciones
          fiscales y legales aplicables. Después los eliminamos o anonimizamos.
        </p>

        <h2 style={s.h2}>7. Cambios a este aviso</h2>
        <p>
          Cualquier cambio a este aviso se publicará en esta misma página, con la fecha de última actualización.
        </p>

        <div style={{ ...s.muted, marginTop: 40 }}>OMNIIOUS · omniious.com</div>
      </div>
    </div>
  )
}
