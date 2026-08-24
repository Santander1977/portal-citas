// Portal público de citas — conectado al backend real (EIS Clinic IA / HRMM).
//
// IMPORTANTE: API_BASE apunta hoy al túnel cloudflared TEMPORAL del backend
// (el mismo que usa el chatbot de n8n). Si el túnel se reinicia, esta URL
// cambia y hay que actualizarla acá. Cuando exista un dominio/backend
// permanente, reemplazar esta constante — es el único lugar que hay que tocar.
const API_BASE = "https://reconstruction-principles-velocity-run.trycloudflare.com";

const PASOS = [
  ["Identifícate", "Datos básicos"],
  ["Servicio", "Elige la especialidad"],
  ["Fecha y hora", "Selecciona el horario"],
  ["Confirmación", "Verifica y confirma"],
];

const estado = {
  paso: 1,
  documento: "",
  nombre: "",
  telefono: "",
  correo: "",
  encontrado: null, // null = no se buscó todavía; true/false tras buscar
  buscando: false,
  servicios: [],
  servicioId: null,
  servicioNombre: "",
  disponibilidad: [],
  fecha: null,
  slotId: null,
  hora: null,
  enviando: false,
  citaCreada: null,
  error: null,
  emailEnviando: false,
  emailResultado: null, // {nivel: "success"|"info"|"error", mensaje}
};

function reiniciar() {
  Object.assign(estado, {
    paso: 1, documento: "", nombre: "", telefono: "", correo: "", encontrado: null, buscando: false,
    servicioId: null, servicioNombre: "", disponibilidad: [], fecha: null, slotId: null,
    hora: null, enviando: false, citaCreada: null, error: null,
    emailEnviando: false, emailResultado: null,
  });
  render();
}

async function apiGet(path) {
  const resp = await fetch(API_BASE + path);
  if (!resp.ok) throw new Error(`Error ${resp.status} consultando ${path}`);
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data && data.detail) || `Error ${resp.status}`);
  }
  return data;
}

async function buscarPaciente() {
  const input = document.getElementById("in-documento");
  estado.documento = (input ? input.value : "").trim();
  if (!estado.documento) {
    estado.error = "Ingresa tu número de documento antes de buscar.";
    render();
    return;
  }
  estado.error = null;
  estado.buscando = true;
  render();
  try {
    const citas = await apiGet("/api/agenda/citas");
    const coincidencias = citas.filter(
      (c) => String(c.documento_paciente || "").trim() === estado.documento
    );
    if (coincidencias.length) {
      coincidencias.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      estado.nombre = coincidencias[0].nombre_paciente;
      estado.telefono = coincidencias[0].telefono;
      estado.encontrado = true;
    } else {
      estado.encontrado = false;
    }
  } catch (e) {
    estado.error = "No pudimos conectar con el sistema de citas. Intenta de nuevo en un momento.";
  }
  estado.buscando = false;
  render();
}

function actualizarCampo(campo, valor) {
  estado[campo] = valor;
}

function irAPaso2() {
  const nombre = document.getElementById("in-nombre");
  const telefono = document.getElementById("in-telefono");
  const correo = document.getElementById("in-correo");
  estado.nombre = (nombre ? nombre.value : estado.nombre || "").trim();
  estado.telefono = (telefono ? telefono.value : estado.telefono || "").trim();
  estado.correo = (correo ? correo.value : estado.correo || "").trim();
  if (!estado.documento || !estado.nombre || !estado.telefono) {
    estado.error = "Completa documento, nombre y teléfono para continuar.";
    render();
    return;
  }
  estado.error = null;
  estado.paso = 2;
  render();
  cargarServicios();
}

async function cargarServicios() {
  if (estado.servicios.length) return;
  try {
    estado.servicios = await apiGet("/api/agenda/servicios");
    render();
  } catch (e) {
    estado.error = "No pudimos cargar los servicios disponibles.";
    render();
  }
}

function elegirServicio(servicioId, nombre) {
  estado.servicioId = servicioId;
  estado.servicioNombre = nombre;
  render();
}

async function irAPaso3() {
  if (!estado.servicioId) {
    estado.error = "Selecciona un servicio para continuar.";
    render();
    return;
  }
  estado.error = null;
  estado.paso = 3;
  estado.fecha = null;
  estado.slotId = null;
  render();
  try {
    const disp = await apiGet("/api/agenda/disponibilidad");
    estado.disponibilidad = disp.filter(
      (b) => b.servicio_id === estado.servicioId && b.estado === "Libre"
    );
  } catch (e) {
    estado.error = "No pudimos cargar la disponibilidad.";
  }
  render();
}

function fechasDisponibles() {
  return [...new Set(estado.disponibilidad.map((b) => b.fecha))].sort();
}

function horasDisponibles() {
  return estado.disponibilidad
    .filter((b) => b.fecha === estado.fecha)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
}

function elegirFecha(fecha) {
  estado.fecha = fecha;
  estado.slotId = null;
  estado.hora = null;
  render();
}

function elegirHora(slotId, hora) {
  estado.slotId = slotId;
  estado.hora = hora;
  render();
}

function irAPaso4() {
  if (!estado.slotId) {
    estado.error = "Selecciona una fecha y hora para continuar.";
    render();
    return;
  }
  estado.error = null;
  estado.paso = 4;
  render();
}

async function confirmarCita() {
  estado.enviando = true;
  estado.error = null;
  render();
  try {
    const cita = await apiPost("/api/agenda/citas", {
      slot_id: estado.slotId,
      documento_paciente: estado.documento,
      nombre_paciente: estado.nombre,
      telefono: estado.telefono,
      canal: "portal_publico",
    });
    estado.citaCreada = cita;
  } catch (e) {
    estado.error = e.message || "No se pudo agendar la cita. Intenta de nuevo.";
  }
  estado.enviando = false;
  render();
}

async function enviarConfirmacionEmail() {
  const input = document.getElementById("in-correo-confirmacion");
  const correo = (input ? input.value : "").trim();
  if (!correo) {
    estado.emailResultado = { nivel: "error", mensaje: "Ingresa un correo antes de enviar." };
    render();
    return;
  }
  estado.correo = correo;
  estado.emailEnviando = true;
  estado.emailResultado = null;
  render(); // deshabilita el botón de inmediato, antes de que arranque el envío
  try {
    const resultado = await apiPost(
      `/api/agenda/citas/${estado.citaCreada.cita_id}/enviar-confirmacion`,
      { email: correo }
    );
    estado.emailResultado = {
      nivel: resultado.exito ? "success" : "info",
      mensaje: resultado.mensaje || (resultado.exito ? "Correo enviado." : "No se pudo enviar el correo."),
    };
  } catch (e) {
    estado.emailResultado = { nivel: "error", mensaje: e.message || "No se pudo enviar el correo." };
  }
  estado.emailEnviando = false;
  render();
}

function volverAPaso(n) {
  estado.error = null;
  estado.paso = n;
  render();
}

function fmtFecha(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function renderSteps() {
  const el = document.getElementById("steps");
  if (!el) return;
  el.innerHTML = PASOS.map(([titulo], i) => {
    const n = i + 1;
    const tag = n === estado.paso ? "b" : "span";
    return `<${tag}>${n}&nbsp; ${titulo}</${tag}>`;
  }).join("");
}

function renderError() {
  return estado.error ? `<div class="alert error">⚠ ${estado.error}</div>` : "";
}

function renderPaso1() {
  const mostrarDatos = estado.encontrado !== null;
  return `
    <h2>Identifícate</h2><p class="muted">Ingresa tu documento para buscar tus datos.</p>
    ${renderError()}
    <div class="field">
      <label>Número de documento</label>
      <div style="display:flex; gap:10px;">
        <input id="in-documento" type="text" placeholder="Ej. 1.234.567.890" value="${estado.documento}">
        <button class="btn primary" onclick="buscarPaciente()" ${estado.buscando ? "disabled" : ""}>
          ${estado.buscando ? "Buscando…" : "Buscar"}
        </button>
      </div>
    </div>
    ${
      mostrarDatos
        ? `
      <div class="alert ${estado.encontrado ? "success" : "info"}">
        ${estado.encontrado ? "✓ Encontramos tus datos de una cita anterior." : "No encontramos ese documento — ingresa tus datos para continuar."}
      </div>
      <div class="row2">
        <div class="field">
          <label>Nombre completo</label>
          <input id="in-nombre" type="text" value="${estado.nombre}" placeholder="Nombre y apellidos">
        </div>
        <div class="field">
          <label>Teléfono</label>
          <input id="in-telefono" type="text" value="${estado.telefono}" placeholder="300 000 0000">
        </div>
      </div>
      <div class="field">
        <label>Correo electrónico (opcional, para recibir la confirmación)</label>
        <input id="in-correo" type="email" value="${estado.correo}" placeholder="tucorreo@ejemplo.com">
      </div>`
        : ""
    }
    <div class="notice">ⓘ <span>Si presentas una emergencia, utiliza el servicio de urgencias. Este portal está orientado a la gestión de citas programables.</span></div>
    <div class="actions bottom">
      <a class="btn light" href="#inicio">Cancelar</a>
      <button class="btn primary" onclick="irAPaso2()" ${mostrarDatos ? "" : "disabled"}>Continuar →</button>
    </div>`;
}

function renderPaso2() {
  const iconos = { "Medicina General": "🩺", "Pediatría": "🧒", "Odontología": "🦷", "Ginecología": "♀️", "Psicología": "🧠", "Urgencias": "➕" };
  return `
    <h2>Selecciona el servicio</h2><p class="muted">Elige la especialidad que necesitas.</p>
    ${renderError()}
    <div class="services" id="servicios">
      ${
        estado.servicios.length
          ? estado.servicios
              .map(
                (s) => `
        <button class="service ${estado.servicioId === s.servicio_id ? "active" : ""}"
                onclick="elegirServicio('${s.servicio_id}', '${s.nombre.replace(/'/g, "\\'")}')">
          ${iconos[s.nombre] || "🩺"}<b>${s.nombre}</b>
        </button>`
              )
              .join("")
          : `<p class="muted">Cargando servicios…</p>`
      }
    </div>
    <div class="actions bottom">
      <button class="btn light" onclick="volverAPaso(1)">← Atrás</button>
      <button class="btn primary" onclick="irAPaso3()" ${estado.servicioId ? "" : "disabled"}>Continuar →</button>
    </div>`;
}

function renderPaso3() {
  const fechas = fechasDisponibles();
  const horas = estado.fecha ? horasDisponibles() : [];
  return `
    <h2>Selecciona la fecha y hora</h2><p class="muted">Disponibilidad para ${estado.servicioNombre}.</p>
    ${renderError()}
    <p class="muted"><b>Fecha disponible</b></p>
    <div class="slots">
      ${
        fechas.length
          ? fechas
              .slice(0, 12)
              .map(
                (f) => `
        <button class="slot ${estado.fecha === f ? "active" : ""}" onclick="elegirFecha('${f}')">${fmtFecha(f)}</button>`
              )
              .join("")
          : `<p class="muted">No hay fechas disponibles para este servicio en este momento.</p>`
      }
    </div>
    ${
      estado.fecha
        ? `
    <p class="muted"><b>Hora disponible</b></p>
    <div class="slots">
      ${horas
        .map(
          (b) => `
        <button class="slot ${estado.slotId === b.slot_id ? "active" : ""}" onclick="elegirHora('${b.slot_id}', '${b.hora_inicio}')">${b.hora_inicio}</button>`
        )
        .join("")}
    </div>
    <p class="muted" style="font-size:12px">Duración estimada de la consulta: 30 minutos.</p>`
        : ""
    }
    <div class="actions bottom">
      <button class="btn light" onclick="volverAPaso(2)">← Atrás</button>
      <button class="btn primary" onclick="irAPaso4()" ${estado.slotId ? "" : "disabled"}>Continuar →</button>
    </div>`;
}

function renderPaso4() {
  if (estado.citaCreada) {
    return `
      <h2>¡Cita confirmada!</h2>
      <div class="alert success">Tu cita quedó registrada con el número ${estado.citaCreada.cita_id}.</div>
      <ul class="summary">
        <li><span>Paciente</span><b>${estado.nombre}</b></li>
        <li><span>Documento</span><b>${estado.documento}</b></li>
        <li><span>Servicio</span><b>${estado.servicioNombre}</b></li>
        <li><span>Fecha</span><b>${fmtFecha(estado.fecha)}</b></li>
        <li><span>Hora</span><b>${estado.hora}</b></li>
      </ul>
      <div class="notice">ⓘ <span>Preséntate 20 minutos antes con tu documento de identidad y carné de EPS. Guarda el número de tu cita.</span></div>
      <div class="field">
        <label>Correo electrónico para recibir la confirmación</label>
        <div style="display:flex; gap:10px;">
          <input id="in-correo-confirmacion" type="email" value="${estado.correo}" placeholder="tucorreo@ejemplo.com">
          <button class="btn primary" onclick="enviarConfirmacionEmail()" ${estado.emailEnviando ? "disabled" : ""}>
            ${estado.emailEnviando ? "Enviando…" : "📧 Enviar por correo"}
          </button>
        </div>
      </div>
      ${
        estado.emailResultado
          ? `<div class="alert ${estado.emailResultado.nivel}">${estado.emailResultado.mensaje}</div>`
          : ""
      }
      <div class="actions bottom">
        <button class="btn primary" onclick="reiniciar()">Agendar otra cita</button>
      </div>`;
  }
  return `
    <h2>Confirma tu cita</h2><p class="muted">Verifica los datos antes de confirmar.</p>
    ${renderError()}
    <ul class="summary">
      <li><span>Paciente</span><b>${estado.nombre}</b></li>
      <li><span>Documento</span><b>${estado.documento}</b></li>
      <li><span>Teléfono</span><b>${estado.telefono}</b></li>
      <li><span>Servicio</span><b>${estado.servicioNombre}</b></li>
      <li><span>Fecha</span><b>${fmtFecha(estado.fecha)}</b></li>
      <li><span>Hora</span><b>${estado.hora}</b></li>
    </ul>
    <div class="actions bottom">
      <button class="btn light" onclick="volverAPaso(3)" ${estado.enviando ? "disabled" : ""}>← Atrás</button>
      <button class="btn primary" onclick="confirmarCita()" ${estado.enviando ? "disabled" : ""}>
        ${estado.enviando ? "Confirmando…" : "✓ Confirmar cita"}
      </button>
    </div>`;
}

function render() {
  renderSteps();
  const wizard = document.getElementById("wizard");
  if (!wizard) return;
  const renders = { 1: renderPaso1, 2: renderPaso2, 3: renderPaso3, 4: renderPaso4 };
  wizard.innerHTML = renders[estado.paso]();
}

document.addEventListener("DOMContentLoaded", render);
