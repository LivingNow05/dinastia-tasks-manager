let selectedTaskId = null;
let selectedLogId = null;
let pollInterval = null;

// Inicialización de la App
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
});

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
          <span>Cron: <code class="cron-spec">${task.cron_expr}</code></span>
        </div>
        <div class="task-actions">
          <button class="btn btn-primary" onclick="runTaskNow(event, ${task.id})">⚡ Ejecutar Ahora</button>
          <button class="btn btn-secondary" onclick="toggleTask(event, ${task.id})">
            ${task.active ? 'Pausar' : 'Activar'}
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
  
  // Buscar la tarjeta correcta y añadirle la clase
  loadTasksListUISelection();

  loadLogs(taskId);
}

function loadTasksListUISelection() {
  // Cargar selección visual sin recargar llamadas pesadas
  const listEl = document.getElementById('tasksList');
  const cards = listEl.children;
  // Solo actualizamos las clases
  loadTasks();
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

// Cargar historial de logs de una tarea específica
async function loadLogs(taskId) {
  const historyListEl = document.getElementById('logsHistoryList');
  try {
    const res = await fetch(`/api/tasks/${taskId}/logs`);
    const logs = await res.json();

    if (logs.length === 0) {
      historyListEl.innerHTML = '<p class="empty-state">No hay historial de ejecuciones registrado.</p>';
      document.getElementById('logConsole').textContent = 'Consola vacía.';
      return;
    }

    historyListEl.innerHTML = '';
    
    let activeRunningLog = null;

    logs.forEach((log, index) => {
      const isSelected = selectedLogId === log.id || (!selectedLogId && index === 0);
      if (isSelected) {
        selectedLogId = log.id;
        document.getElementById('logConsole').textContent = log.log_output || 'Ejecutando sin output aún...';
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
  
  // Actualizar selección visual
  const rows = document.querySelectorAll('.log-row');
  rows.forEach(row => row.classList.remove('selected'));
  
  // Cargar consola
  document.getElementById('logConsole').textContent = fullOutput || 'Ejecutando sin output aún...';
  
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
          // Auto-scroll al final del log
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
}

// Cerrar modal de nueva tarea
function closeNewTaskModal() {
  document.getElementById('newTaskModal').style.display = 'none';
  document.getElementById('newTaskForm').reset();
}

// Crear nueva tarea por API
async function createNewTask(event) {
  event.preventDefault();
  
  const name = document.getElementById('taskName').value;
  const type = document.getElementById('taskType').value;
  const cron_expr = document.getElementById('taskCron').value;
  const prompt = document.getElementById('taskPrompt').value;

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
