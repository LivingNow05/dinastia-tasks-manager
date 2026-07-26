let selectedTaskId = null;
let selectedLogId = null;
let pollInterval = null;
let currentTab = 'summary'; // 'summary' o 'console'

// Inicialización de la App
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
});

// Helper para convertir la expresión cron a un texto amigable y legible
function formatCronFriendly(cronExpr) {
  try {
    const parts = cronExpr.split(' ');
    if (parts.length === 5) {
      const [min, hour, dom, mon, dow] = parts;
      const pad = (num) => String(num).padStart(2, '0');
      const timeStr = `${pad(hour)}:${pad(min)}`;
      
      if (dom === '*' && mon === '*' && dow === '*') {
        return `Todos los días a las ${timeStr}`;
      }
      if (dom === '*' && mon === '*' && dow !== '*') {
        const days = { '1': 'Lunes', '2': 'Martes', '3': 'Miércoles', '4': 'Jueves', '5': 'Viernes', '6': 'Sábado', '0': 'Domingo' };
        const dayName = days[dow] || `Día ${dow}`;
        return `Los ${dayName} a las ${timeStr}`;
      }
    }
  } catch (e) {}
  return cronExpr;
}

// Obtener y renderizar las tareas
async function loadTasks() {
  const listEl = document.getElementById('tasksList');
  try {
    const res = await fetch('/api/tasks');
    const tasks = await res.json();

    if (tasks.length === 0) {
      listEl.innerHTML = '<p class="empty-state">No hay tareas programadas creadas.</p>';
      return;
    }

    listEl.innerHTML = '';
    tasks.forEach(task => {
      const isSelected = selectedTaskId === task.id;
      const card = document.createElement('div');
      card.className = `task-card ${isSelected ? 'selected' : ''}`;
      card.onclick = () => selectTask(task.id);

      card.innerHTML = `
        <div class="task-title-area">
          <h3>${task.name}</h3>
          <span class="task-badge ${task.active ? 'active' : 'inactive'}">
            ${task.active ? 'Activa' : 'Pausada'}
          </span>
        </div>
        <p class="task-desc">${task.prompt || 'Sin descripción'}</p>
        <div class="task-meta">
          <span>Horario: <code class="cron-spec">${formatCronFriendly(task.cron_expr)}</code></span>
        </div>
        <div class="task-actions">
          <button class="btn btn-primary" onclick="runTaskNow(event, ${task.id})">⚡ Ejecutar Ahora</button>
          <button class="btn btn-secondary" onclick="toggleTask(event, ${task.id})">
            ${task.active ? 'Pausar' : 'Activar'}
          </button>
          <button class="btn btn-secondary btn-danger" onclick="deleteTask(event, ${task.id})" style="border-color: rgba(239, 68, 68, 0.3); color: var(--danger-color);">
            🗑️ Eliminar
          </button>
        </div>
      `;
      listEl.appendChild(card);
    });

    // Auto-seleccionar la primera tarea si no hay ninguna seleccionada
    if (!selectedTaskId && tasks.length > 0) {
      selectTask(tasks[0].id);
    }
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state" style="color: var(--danger-color)">Error al cargar tareas: ${err.message}</p>`;
  }
}

// Seleccionar una tarea y cargar sus logs
function selectTask(taskId) {
  selectedTaskId = taskId;
  
  // Resaltar tarjeta seleccionada en la UI
  const cards = document.querySelectorAll('.task-card');
  cards.forEach(card => card.classList.remove('selected'));

  loadLogs(taskId);
}

// Alternar el estado activo/pausado de una tarea
async function toggleTask(event, taskId) {
  event.stopPropagation(); // Evitar click en la tarjeta completa
  try {
    const res = await fetch(`/api/tasks/${taskId}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadTasks();
    }
  } catch (err) {
    alert('Error al alternar el estado de la tarea: ' + err.message);
  }
}

// Eliminar una tarea programada
async function deleteTask(event, taskId) {
  event.stopPropagation(); // Evitar click en la tarjeta completa
  if (!confirm('¿Estás seguro de que deseas eliminar esta tarea de forma permanente?')) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (selectedTaskId === taskId) selectedTaskId = null;
      loadTasks();
    }
  } catch (err) {
    alert('Error al eliminar la tarea: ' + err.message);
  }
}

// Lanzar ejecución manual
async function runTaskNow(event, taskId) {
  event.stopPropagation(); // Evitar click en la tarjeta completa
  try {
    const res = await fetch(`/api/tasks/${taskId}/run`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      // Forzar recarga inmediata de los logs
      loadLogs(taskId);
      alert('Se ha iniciado la ejecución de la tarea en segundo plano. Los logs se actualizarán automáticamente.');
    }
  } catch (err) {
    alert('Error al ejecutar la tarea: ' + err.message);
  }
}

// Intercambiar vista entre Resumen y Consola Raw
function switchLogTab(tabName) {
  currentTab = tabName;
  const btnSummary = document.getElementById('btnTabSummary');
  const btnConsole = document.getElementById('btnTabConsole');
  const summaryContent = document.getElementById('logTabSummaryContent');
  const consoleContent = document.getElementById('logConsole');

  if (tabName === 'summary') {
    btnSummary.classList.add('active');
    btnConsole.classList.remove('active');
    summaryContent.style.display = 'block';
    consoleContent.style.display = 'none';
  } else {
    btnSummary.classList.remove('active');
    btnConsole.classList.add('active');
    summaryContent.style.display = 'none';
    consoleContent.style.display = 'block';
  }
}

// Función analizadora del log string para extraer envíos estructurados
function parseLogOutput(logStr) {
  if (!logStr) return [];
  const clientBlocks = logStr.split('--- PROCESANDO CLIENTE');
  const results = [];
  
  for (let i = 1; i < clientBlocks.length; i++) {
    const block = clientBlocks[i];
    
    // Extraer número
    const numberMatch = block.match(/\(\d+\/\d+\):\s*([^\s-]+)/);
    const number = numberMatch ? numberMatch[1].replace('@s.whatsapp.net', '') : 'Desconocido';
    
    // Extraer mensaje generado
    const msgMatch = block.match(/Mensaje generado:\s*["'«]([^"']+)["'»]/);
    const message = msgMatch ? msgMatch[1] : '';
    
    // Extraer Message ID
    const idMatch = block.match(/ID de mensaje:\s*([A-Za-z0-9]+)/);
    const messageId = idMatch ? idMatch[1] : '';
    
    let status = 'error';
    let details = '';
    
    if (block.includes('Enviado con éxito')) {
      status = 'success';
    } else {
      const errMatch = block.match(/Error procesando cliente[^:]*:\s*([^\n\r]+)/);
      details = errMatch ? errMatch[1] : 'Error en el proceso de envío';
    }
    
    results.push({
      number,
      message,
      messageId,
      status,
      details
    });
  }
  return results;
}

// Renderizar la tabla interactiva de resultados
function renderSummaryTable(parsedLogs) {
  const container = document.getElementById('logTabSummaryContent');
  if (parsedLogs.length === 0) {
    container.innerHTML = '<p class="empty-state">No se registraron envíos de mensajes en esta ejecución o está en proceso de inicio...</p>';
    return;
  }
  
  let html = `
    <table class="summary-table" style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
      <thead>
        <tr style="border-bottom: 2px solid var(--card-border); color: var(--text-secondary);">
          <th style="padding: 10px;">Teléfono</th>
          <th style="padding: 10px;">Mensaje de Seguimiento</th>
          <th style="padding: 10px;">ID Envío / Detalles</th>
          <th style="padding: 10px;">Estado</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  parsedLogs.forEach(log => {
    const isSuccess = log.status === 'success';
    const statusText = isSuccess ? '✅ Enviado' : '❌ Fallido';
    const color = isSuccess ? 'var(--success-color)' : 'var(--danger-color)';
    const idOrError = isSuccess ? `<code class="cron-spec" style="font-size: 11px;">${log.messageId}</code>` : `<span style="color: var(--danger-color); font-size: 12px;">${log.details}</span>`;
    
    html += `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.03);">
        <td style="padding: 12px 10px; font-weight: 500; white-space: nowrap;">+${log.number}</td>
        <td style="padding: 12px 10px; color: var(--text-primary); line-height: 1.4;">${log.message || '—'}</td>
        <td style="padding: 12px 10px;">${idOrError}</td>
        <td style="padding: 12px 10px; font-weight: 500; color: ${color}; white-space: nowrap;">${statusText}</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

// Cargar historial de logs de una tarea específica
async function loadLogs(taskId) {
  const historyListEl = document.getElementById('logsHistoryList');
  try {
    const res = await fetch(`/api/tasks/${taskId}/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      historyListEl.innerHTML = '<p class="empty-state">No hay historial de ejecuciones registrado.</p>';
      document.getElementById('logConsole').textContent = 'Consola vacía.';
      document.getElementById('logTabSummaryContent').innerHTML = '<p class="empty-state">Sin datos de envíos.</p>';
      return;
    }

    historyListEl.innerHTML = '';
    
    let activeRunningLog = null;

    logs.forEach((log, index) => {
      const isSelected = selectedLogId === log.id || (!selectedLogId && index === 0);
      if (isSelected) {
        selectedLogId = log.id;
        
        // Cargar consola raw
        document.getElementById('logConsole').textContent = log.log_output || 'Ejecutando sin output aún...';
        
        // Renderizar tabla resumen parseada
        const parsed = parseLogOutput(log.log_output);
        renderSummaryTable(parsed);
      }

      if (log.status === 'running') {
        activeRunningLog = log;
      }

      const row = document.createElement('div');
      row.className = `log-row ${isSelected ? 'selected' : ''}`;
      row.onclick = () => selectLog(log.id, log.log_output);

      const localTime = new Date(log.executed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
      const duration = log.duration_ms ? `${Math.round(log.duration_ms / 1000)}s` : '--';
      
      row.innerHTML = `
        <span class="log-time">${localTime}</span>
        <span class="log-status ${log.status}">${log.status.toUpperCase()}</span>
        <span class="log-msg-preview">${log.log_output ? log.log_output.split('\n')[0].substring(0, 40) + '...' : 'Iniciando...'}</span>
        <span class="log-duration">${duration}</span>
      `;
      historyListEl.appendChild(row);
    });

    // Controlar el polling automático si hay una tarea en ejecución
    if (activeRunningLog) {
      startPolling(taskId, activeRunningLog.id);
    } else {
      stopPolling();
    }

  } catch (err) {
    historyListEl.innerHTML = `<p class="empty-state" style="color: var(--danger-color)">Error al cargar logs: ${err.message}</p>`;
  }
}

// Seleccionar un log individual para mostrar en la consola
function selectLog(logId, fullOutput) {
  selectedLogId = logId;
  
  // Cargar consola raw
  document.getElementById('logConsole').textContent = fullOutput || 'Ejecutando sin output aún...';
  
  // Renderizar tabla resumen parseada
  const parsed = parseLogOutput(fullOutput);
  renderSummaryTable(parsed);
  
  // Recargar la lista de logs para asegurar clase "selected"
  loadLogs(selectedTaskId);
}

// Iniciar polling de logs cada 3 segundos
function startPolling(taskId, logId) {
  if (pollInterval) return; // Evitar múltiples intervalos
  
  console.log('Iniciando pooling en tiempo real de logs...');
  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/logs`);
      const logs = await res.json();
      
      const currentLog = logs.find(l => l.id === logId);
      if (currentLog) {
        // Actualizar la consola si es el log seleccionado actualmente
        if (selectedLogId === logId) {
          const consoleEl = document.getElementById('logConsole');
          consoleEl.textContent = currentLog.log_output || 'Ejecutando sin output aún...';
          
          // Actualizar tabla resumen parseada
          const parsed = parseLogOutput(currentLog.log_output);
          renderSummaryTable(parsed);

          // Auto-scroll al final de la consola
          consoleEl.scrollTop = consoleEl.scrollHeight;
        }

        // Si la tarea terminó, detener el polling
        if (currentLog.status !== 'running') {
          console.log('La tarea ha finalizado. Deteniendo polling.');
          stopPolling();
          loadLogs(taskId);
        }
      }
    } catch (err) {
      console.error('Error en polling de logs:', err);
    }
  }, 3000);
}

// Detener el polling
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('Polling detenido.');
  }
}

// Abrir modal de nueva tarea
function openNewTaskModal() {
  document.getElementById('newTaskModal').style.display = 'flex';
  handleFrequencyChange(); // Inicializar visualización
}

// Cerrar modal de nueva tarea
function closeNewTaskModal() {
  document.getElementById('newTaskModal').style.display = 'none';
  document.getElementById('newTaskForm').reset();
}

// Reactividad en el formulario del modal
function handleFrequencyChange() {
  const freq = document.getElementById('taskFrequency').value;
  const timeRow = document.getElementById('timeRow');
  const timeGroup = document.getElementById('timeGroup');
  const dayOfWeekGroup = document.getElementById('dayOfWeekGroup');
  const cronGroup = document.getElementById('cronGroup');

  if (freq === 'daily') {
    timeRow.style.display = 'flex';
    timeGroup.style.display = 'flex';
    dayOfWeekGroup.style.display = 'none';
    cronGroup.style.display = 'none';
  } else if (freq === 'weekly') {
    timeRow.style.display = 'flex';
    timeGroup.style.display = 'flex';
    dayOfWeekGroup.style.display = 'flex';
    cronGroup.style.display = 'none';
  } else if (freq === 'cron') {
    timeRow.style.display = 'none';
    cronGroup.style.display = 'flex';
  }
}

// Crear nueva tarea por API
async function createNewTask(event) {
  event.preventDefault();
  
  const name = document.getElementById('taskName').value;
  const type = document.getElementById('taskType').value;
  const freq = document.getElementById('taskFrequency').value;
  const prompt = document.getElementById('taskPrompt').value;

  // Construir expresión cron a partir de las entradas visuales
  let cron_expr = '';
  if (freq === 'daily') {
    const timeVal = document.getElementById('taskTime').value;
    if (!timeVal) return alert('Por favor, selecciona una hora de ejecución.');
    const [hour, min] = timeVal.split(':');
    cron_expr = `${parseInt(min)} ${parseInt(hour)} * * *`;
  } else if (freq === 'weekly') {
    const timeVal = document.getElementById('taskTime').value;
    const dayOfWeek = document.getElementById('taskDayOfWeek').value;
    if (!timeVal) return alert('Por favor, selecciona una hora de ejecución.');
    const [hour, min] = timeVal.split(':');
    cron_expr = `${parseInt(min)} ${parseInt(hour)} * * ${dayOfWeek}`;
  } else if (freq === 'cron') {
    cron_expr = document.getElementById('taskCron').value;
    if (!cron_expr) return alert('Por favor, introduce una expresión cron válida.');
  }

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, type, cron_expr, prompt })
    });

    const data = await res.json();
    
    if (res.status === 201) {
      alert('✓ Tarea programada creada y programada con éxito.');
      closeNewTaskModal();
      loadTasks();
    } else {
      alert('Error: ' + (data.error || 'No se pudo crear la tarea'));
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
  }
}
