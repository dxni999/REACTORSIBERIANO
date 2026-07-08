// =============================================================
// PANEL DE CONTROL — CENTRAL NUCLEAR SIBERIANA
// Lógica del simulacro de emergencia (Feria de Ciencias — HCI)
// =============================================================

// --- 1. CONFIGURACIÓN Y ESTADO GLOBAL ---
const TIEMPO_INICIAL = 30;
const TEMP_INICIAL = 380;
const TEMP_CRITICA = 400;
const TEMP_MIN_ESCALA = 300;
const TEMP_MAX_ESCALA = 550;
const AGUA_INICIAL = 50;
const ENERGIA_MAX = 1200;
const SEGMENTOS_BARRA = 20;

const NOMBRES_PASO = {
  1: 'Detener las turbinas de generación',
  2: 'Ventilar el contenido radiactivo',
  3: 'Evacuar agua caliente e ingresar agua fría',
  4: 'Apagar el reactor',
  5: 'Presionar el botón de emergencia'
};

let estado = crearEstadoInicial();
let intervaloJuego = null;
let intervaloAlarma = null;
let audioCtx = null;
let temporizadorAlerta = null;

function crearEstadoInicial() {
  return {
    activo: false,
    tiempoRestante: TIEMPO_INICIAL,
    paso: 0,
    temperatura: TEMP_INICIAL,
    temperaturaAgua: 130,      // NUEVA VARIABLE: Temperatura independiente del agua
    alertaAguaEmitida: false,  // NUEVA VARIABLE: Evita spam de la alerta del agua
    reactorEncendido: true, 
    agua: AGUA_INICIAL,
    energia: Math.round(TEMP_INICIAL * 2.1),
    errores: 0,
    aguaEvacuada: false,
    aguaIngresada: false,
    inicioTS: 0,
    registro: []
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// --- 2. SONIDO ---
function obtenerAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

function tono(frecuencia, duracion, tipo, volumen, retardo) {
  duracion = duracion || 0.12;
  tipo = tipo || 'square';
  volumen = volumen || 0.06;
  retardo = retardo || 0;
  try {
    const ctx = obtenerAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + retardo;
    gain.gain.setValueAtTime(volumen, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracion);
    osc.start(t0);
    osc.stop(t0 + duracion + 0.02);
  } catch (e) { }
}

const sonido = {
  click: function () { tono(660, 0.05, 'square', 0.05, 0); },
  exito: function () { tono(523, 0.1, 'square', 0.06, 0); tono(659, 0.1, 'square', 0.06, 0.1); tono(784, 0.18, 'square', 0.06, 0.2); },
  error: function () { tono(160, 0.2, 'sawtooth', 0.09, 0); },
  alarma: function () { tono(880, 0.15, 'square', 0.07, 0); tono(660, 0.15, 'square', 0.07, 0.18); },
  explosion: function () { tono(120, 0.5, 'sawtooth', 0.13, 0); tono(55, 0.9, 'sawtooth', 0.13, 0.15); }
};

// --- 3. CICLO PRINCIPAL DE SIMULACIÓN ---
function iniciarSimulacion() {
  clearInterval(intervaloJuego);
  detenerAlarma();
  estado = crearEstadoInicial();
  estado.activo = true;
  estado.inicioTS = Date.now();

  obtenerAudioCtx();

  document.getElementById('overlayInicio').classList.add('hidden');
  document.getElementById('overlayDerrota').classList.add('hidden');
  document.getElementById('telemetria').classList.add('hidden');
  document.getElementById('consola').classList.remove('critico');
  
  document.getElementById('alertaVictoria').classList.remove('visible');
  document.getElementById('btnReiniciarManual').classList.add('hidden');

  resetearBotones();
  registrar('Simulacro iniciado. Cuenta regresiva: ' + TIEMPO_INICIAL + 's.');
  render();

  intervaloJuego = setInterval(cicloDelReactor, 1000);
}

function cicloDelReactor() {
  if (!estado.activo) return;
  estado.tiempoRestante--;

  // La temperatura sube si el reactor está encendido y la secuencia no está avanzada
  if (estado.reactorEncendido && estado.paso < 3) {
    estado.temperatura += Math.floor(Math.random() * 10) + 5;
    // El agua sube rápido para que el jugador se vea obligado a actuar antes de que acabe el tiempo
    estado.temperaturaAgua += Math.floor(Math.random() * 20) + 20; 
  } else {
    // Si se apaga o completa la secuencia, se enfrían ambos
    estado.temperatura = Math.max(20, estado.temperatura - 5);
    estado.temperaturaAgua = Math.max(20, estado.temperaturaAgua - 15);
  }

  estado.energia = (estado.paso >= 4 || !estado.reactorEncendido) ? 0 : Math.round(estado.temperatura * 2.1);

  gestionarAlarmaCritica();
  render();

  if (estado.tiempoRestante <= 0) {
    derrota();
  }
}

// --- APAGAR/PRENDER REACTOR ---
function toggleReactor() {
  if (!estado.activo) return;
  estado.reactorEncendido = !estado.reactorEncendido;
  sonido.click();
  registrar('Reactor ' + (estado.reactorEncendido ? 'ENCENDIDO' : 'APAGADO') + ' manualmente.');
  render();
}

// --- 4. CONTROL DE LA SECUENCIA OBLIGATORIA ---
function intentarPaso(numero) {
  if (!estado.activo) return;

  if (numero === estado.paso + 1) {
    estado.paso = numero;
    registrar('Paso ' + numero + ' completado: ' + NOMBRES_PASO[numero] + '.');
    marcarBotonCompletado(numero);
    sonido.exito();

    if (numero === 4) {
      estado.reactorEncendido = false; // El paso 4 apaga el reactor
      document.getElementById('emergenciaAssembly').classList.remove('bloqueada');
      document.getElementById('btnEmergencia').disabled = false;
    }
    render();
  } else {
    denegarAccion(numero);
  }
}

function intentarTapaEmergencia() {
  if (!estado.activo) return;
  const assembly = document.getElementById('emergenciaAssembly');

  if (estado.paso === 4) {
    assembly.classList.add('abierta');
    sonido.click();
    registrar('Tapa de seguridad retirada. Botón de emergencia habilitado.');
  } else {
    denegarAccion(5);
    assembly.classList.add('shake');
    setTimeout(function () { assembly.classList.remove('shake'); }, 400);
  }
}

function intentarBotonMushroom() {
  if (!estado.activo) return;
  const assembly = document.getElementById('emergenciaAssembly');
  if (!assembly.classList.contains('abierta')) return;
  intentarPaso(5);
  if (estado.paso === 5) victoria();
}

function denegarAccion(numeroIntentado) {
  estado.errores++;
  const siguiente = estado.paso + 1;
  const nombreSiguiente = NOMBRES_PASO[siguiente] || 'la secuencia';
  const mensaje = 'Secuencia incorrecta. Por favor, ejecute el Paso ' + siguiente + ': ' +
    nombreSiguiente + ' antes de continuar.';
  mostrarAlertaDenegada(mensaje);
  sonido.error();
  registrar('ERROR (#' + estado.errores + '): intento de ejecutar el paso ' + numeroIntentado + ' fuera de orden.');
  render();
}

// --- 5. CONTROLES DE AGUA ---
function gestionarAgua(accion) {
  if (!estado.activo) return;

  if (accion === 'ingresar') {
    estado.agua = Math.min(100, estado.agua + 10);
    estado.aguaIngresada = true;
    estado.temperatura = Math.max(0, estado.temperatura - 15);
    // Ingresar agua fría disminuye drásticamente la temperatura del agua general
    estado.temperaturaAgua = Math.max(20, estado.temperaturaAgua - 50); 
  } else if (accion === 'desfogar') {
    estado.agua = Math.max(0, estado.agua - 10);
    estado.aguaEvacuada = true;
  }

  sonido.click();
  verificarActivacionPaso3();
  render();
}

function verificarActivacionPaso3() {
  if (estado.paso === 2 && estado.aguaEvacuada && estado.aguaIngresada) {
    estado.paso = 3;
    marcarBotonCompletado(3);
    registrar('Paso 3 completado: ciclo de refrigeración ejecutado con los controles de agua.');
    sonido.exito();
  }
}

// --- 6. RESOLUCIÓN DEL SIMULACRO ---
function victoria() {
  estado.activo = false;
  clearInterval(intervaloJuego);
  detenerAlarma();
  
  estado.energia = 0;
  render();
  sonido.exito();

  const transcurrido = TIEMPO_INICIAL - estado.tiempoRestante;
  registrar('ÉXITO: central estabilizada en ' + transcurrido + 's con ' + estado.errores + ' error(es).');

  document.getElementById('alertaVictoria').classList.add('visible');
  document.getElementById('btnReiniciarManual').classList.remove('hidden');

  mostrarTelemetriaFinal('VICTORIA — Central estabilizada con éxito', transcurrido, estado.errores);
}

function derrota() {
  estado.activo = false;
  clearInterval(intervaloJuego);
  detenerAlarma();
  sonido.explosion();

  registrar('FRACASO: explosión a los ' + TIEMPO_INICIAL + 's con ' + estado.errores + ' error(es). Paso alcanzado: ' + estado.paso + '/5.');

  document.getElementById('statDerrotaPaso').innerText = estado.paso + '/5';
  document.getElementById('statDerrotaErrores').innerText = estado.errores;
  document.getElementById('overlayDerrota').classList.remove('hidden');
  render();

  mostrarTelemetriaFinal('EXPLOSIÓN — Fusión del núcleo (tiempo agotado)', TIEMPO_INICIAL, estado.errores);
}

function mostrarTelemetriaFinal(estadoFinal, tiempoEmpleado, clicsErroneos) {
  document.getElementById('resultadoFinalDisplay').innerText = estadoFinal;
  document.getElementById('tiempoFinalDisplay').innerText = tiempoEmpleado;
  document.getElementById('erroresFinalDisplay').innerText = clicsErroneos;
  document.getElementById('telemetria').classList.remove('hidden');
}

// --- 7. ALARMA VISUAL Y AUDITIVA ---
function gestionarAlarmaCritica() {
  const consola = document.getElementById('consola');
  if (estado.temperatura >= TEMP_CRITICA) {
    consola.classList.add('critico');
    if (!intervaloAlarma) {
      sonido.alarma();
      intervaloAlarma = setInterval(sonido.alarma, 2000);
    }
  } else {
    consola.classList.remove('critico');
    detenerAlarma();
  }
}

function detenerAlarma() {
  if (intervaloAlarma) {
    clearInterval(intervaloAlarma);
    intervaloAlarma = null;
  }
}

// --- 8. RENDERIZADO DE LA INTERFAZ ---
function render() {
  const t = Math.max(0, estado.tiempoRestante);
  document.getElementById('timerDisplay').innerText = String(t).padStart(2, '0') + 's';

  document.getElementById('tempDisplay').innerText = estado.temperatura + '°C';
  document.getElementById('tempDisplay').classList.toggle('valor-critico', estado.temperatura >= TEMP_CRITICA);
  
  const frac = clamp((estado.temperatura - TEMP_MIN_ESCALA) / (TEMP_MAX_ESCALA - TEMP_MIN_ESCALA), 0, 1);
  const angulo = -90 + frac * 180;
  const aguja = document.getElementById('agujaGauge');
  if (aguja) aguja.setAttribute('transform', 'rotate(' + angulo.toFixed(1) + ' 110 120)');

  // Render Temperatura del Agua (Independiente)
  document.getElementById('tempAguaDisplay').innerText = estado.temperaturaAgua + '°C';
  
  // ALERTA DE AGUA > 400°C 
  if (estado.temperaturaAgua >= 400) {
    document.getElementById('tempAguaDisplay').classList.add('valor-critico');
    // Emite la alerta visual roja solo si no se ha emitido en este pico de calor
    if (estado.activo && !estado.alertaAguaEmitida) {
      mostrarAlertaDenegada("¡ALERTA! El agua refrigerante superó los 400°C");
      sonido.error();
      registrar('ALERTA: Temperatura del agua crítica (>400°C).');
      estado.alertaAguaEmitida = true;
    }
  } else {
    // Si la bajan de 400, reseteamos las clases y la bandera de alerta
    document.getElementById('tempAguaDisplay').classList.remove('valor-critico');
    estado.alertaAguaEmitida = false;
  }

  // Botón Encendido/Apagado
  document.getElementById('textoToggleReactor').innerText = estado.reactorEncendido ? 'Apagar Reactor' : 'Prender Reactor';

  document.getElementById('aguaDisplay').innerText = estado.agua + '%';
  const relleno = document.getElementById('tanqueRelleno');
  if (relleno) relleno.style.height = estado.agua + '%';
  document.getElementById('tanqueContenedor').classList.toggle('hirviendo', estado.temperatura >= TEMP_CRITICA || estado.temperaturaAgua >= 400);

  document.getElementById('energiaDisplay').innerText = estado.energia + ' MWe';
  renderSegmentosEnergia();

  document.getElementById('erroresDisplay').innerText = estado.errores;
  renderRegistro();
}

function renderSegmentosEnergia() {
  const activos = Math.round(clamp(estado.energia / ENERGIA_MAX, 0, 1) * SEGMENTOS_BARRA);
  const contenedor = document.getElementById('barraEnergia');
  if (!contenedor) return;
  Array.prototype.forEach.call(contenedor.children, function (seg, i) {
    seg.classList.toggle('activo', i < activos);
    seg.classList.toggle('alto', i < activos && i >= 14);
    seg.classList.toggle('critico-seg', i < activos && i >= 18);
  });
}

// --- 9. REGISTRO DE TELEMETRÍA ---
function registrar(texto) {
  const t = estado.inicioTS ? ((Date.now() - estado.inicioTS) / 1000).toFixed(1) : '0.0';
  estado.registro.push('[T+' + t + 's] ' + texto);
  renderRegistro();
}

function renderRegistro() {
  const panel = document.getElementById('logRegistro');
  if (!panel) return;
  panel.innerHTML = estado.registro.map(function (l) { return '<div>' + l + '</div>'; }).join('');
  panel.scrollTop = panel.scrollHeight;
}

function exportarRegistro() {
  const texto = estado.registro.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(function () {
      mostrarToast('Registro copiado al portapapeles.');
    }).catch(function () {
      mostrarToast('No se pudo copiar. Selecciónelo manualmente.');
    });
  } else {
    mostrarToast('Portapapeles no disponible en este navegador.');
  }
}

// --- 10. ALERTAS EN PANTALLA ---
function mostrarAlertaDenegada(mensaje) {
  const el = document.getElementById('alertaDenegada');
  el.innerText = mensaje;
  el.classList.add('visible');
  document.getElementById('consola').classList.add('sacudida');
  clearTimeout(temporizadorAlerta);
  temporizadorAlerta = setTimeout(function () {
    el.classList.remove('visible');
    document.getElementById('consola').classList.remove('sacudida');
  }, 1900);
}

function mostrarToast(mensaje) {
  const el = document.getElementById('toast');
  el.innerText = mensaje;
  el.classList.add('visible');
  setTimeout(function () { el.classList.remove('visible'); }, 2200);
}

// --- 11. UTILIDADES DE BOTONES ---
function marcarBotonCompletado(numero) {
  const boton = document.getElementById('btnPaso' + numero);
  if (boton) {
    boton.classList.add('completado');
    boton.disabled = true;
  }
  const indicador = document.getElementById('ledPaso' + numero);
  if (indicador) indicador.classList.add('ok');
}

function resetearBotones() {
  [1, 2, 4].forEach(function (i) {
    const b = document.getElementById('btnPaso' + i);
    b.disabled = false;
    b.classList.remove('completado');
    document.getElementById('ledPaso' + i).classList.remove('ok');
  });
  const btn3 = document.getElementById('btnPaso3');
  btn3.disabled = true;
  btn3.classList.remove('completado');
  document.getElementById('ledPaso3').classList.remove('ok');

  const assembly = document.getElementById('emergenciaAssembly');
  assembly.classList.add('bloqueada');
  assembly.classList.remove('abierta', 'shake');
  document.getElementById('btnEmergencia').disabled = true;
}

// --- 12. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', function () {
  const contenedor = document.getElementById('barraEnergia');
  for (let i = 0; i < SEGMENTOS_BARRA; i++) {
    const span = document.createElement('span');
    span.className = 'segmento';
    contenedor.appendChild(span);
  }
  render();
});
