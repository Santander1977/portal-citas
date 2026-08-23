const N8N_BASE = 'https://curson8n-n8n.byrp3l.easypanel.host/webhook';

const state = { servicio: null, horario: null };

const buttons = document.querySelectorAll('.service');
const toast = document.getElementById('toast');
const cont = document.getElementById('continue');
const insideEl = document.querySelector('.booking .inside');

buttons.forEach(b => b.onclick = () => {
  buttons.forEach(x => x.classList.remove('active'));
  b.classList.add('active');
});

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

async function callWebhook(path, payload) {
  const res = await fetch(`${N8N_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Error de red: ' + res.status);
  return res.json();
}

cont.onclick = async () => {
  const activeBtn = document.querySelector('.service.active');
  if (!activeBtn) { showToast('Selecciona un servicio para continuar.'); return; }
  state.servicio = activeBtn.dataset.name;
  cont.disabled = true;
  const original = cont.textContent;
  cont.textContent = 'Consultando disponibilidad...';
  try {
    const data = await callWebhook('consultar-disponibilidad', { servicio: state.servicio });
    renderHorarios(data.horarios || []);
  } catch (e) {
    showToast('No se pudo consultar disponibilidad. Intenta de nuevo.');
    cont.disabled = false;
    cont.textContent = original;
  }
};

function renderHorarios(horarios) {
  insideEl.innerHTML = `
    <h2>Elige un horario</h2>
    <p class="muted">Servicio seleccionado: <b>${state.servicio}</b></p>
    <div class="services" id="horarios">
      ${horarios.map(h => `<button class="service" data-h="${h}"><b>${h}</b></button>`).join('')}
    </div>
    <div class="notice">ⓘ <span>Horarios disponibles obtenidos en tiempo real desde n8n.</span></div>
    <div class="actions bottom">
      <a class="btn light" href="#" id="back1">Atrás</a>
      <button class="btn primary" id="continue2">Continuar →</button>
    </div>
  `;
  document.querySelectorAll('#horarios.services .service').forEach(b => b.onclick = () => {
    document.querySelectorAll('#horarios.services .service').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
  document.getElementById('back1').onclick = (e) => { e.preventDefault(); location.reload(); };
  document.getElementById('continue2').onclick = () => {
    const activeH = document.querySelector('#horarios.services .service.active');
    if (!activeH) { showToast('Selecciona un horario.'); return; }
    state.horario = activeH.dataset.h;
    renderDatos();
  };
}

function renderDatos() {
  insideEl.innerHTML = `
    <h2>Tus datos</h2>
    <p class="muted">${state.servicio} · ${state.horario}</p>
    <div class="fields">
      <input class="field" id="f-nombre" placeholder="Nombre completo" />
      <input class="field" id="f-documento" placeholder="Documento de identidad" />
      <input class="field" id="f-telefono" placeholder="Teléfono" />
      <input class="field" id="f-email" placeholder="Correo electrónico" />
    </div>
    <div class="actions bottom">
      <a class="btn light" href="#" id="back2">Atrás</a>
      <button class="btn primary" id="confirmar">Confirmar cita</button>
    </div>
  `;
  document.getElementById('back2').onclick = (e) => { e.preventDefault(); location.reload(); };
  document.getElementById('confirmar').onclick = async () => {
    const paciente = {
      nombre: document.getElementById('f-nombre').value,
      documento: document.getElementById('f-documento').value,
      telefono: document.getElementById('f-telefono').value,
      email: document.getElementById('f-email').value
    };
    if (!paciente.nombre || !paciente.documento) { showToast('Completa al menos nombre y documento.'); return; }
    const btn = document.getElementById('confirmar');
    btn.disabled = true;
    btn.textContent = 'Agendando...';
    try {
      const data = await callWebhook('agendar-cita', {
        servicio: state.servicio,
        hora: state.horario,
        paciente
      });
      // Dispara la confirmación (no bloqueante para el usuario)
      callWebhook('enviar-confirmacion', { citaId: data.citaId, canal: 'email' }).catch(() => {});
      renderConfirmacion(data);
    } catch (e) {
      showToast('No se pudo agendar la cita. Intenta de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Confirmar cita';
    }
  };
}

function renderConfirmacion(data) {
  insideEl.innerHTML = `
    <h2>¡Cita agendada!</h2>
    <p class="muted">${data.mensaje || 'Tu cita fue registrada correctamente.'}</p>
    <div class="notice">ⓘ <span>Número de confirmación: <b>${data.citaId || '-'}</b></span></div>
    <div class="actions bottom">
      <a class="btn primary" href="#inicio" onclick="location.reload()">Volver al inicio</a>
    </div>
  `;
}
