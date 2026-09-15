export function connectSse({ onLog, onTask, onStatus, onNotify, onOpen, onError }) {
  const token = encodeURIComponent(localStorage.getItem('zjgsu.tool.token') || '');
  const es = new EventSource(`/api/events?token=${token}`);

  es.addEventListener('log', (e) => onLog?.(JSON.parse(e.data)));
  es.addEventListener('task', (e) => onTask?.(JSON.parse(e.data)));
  es.addEventListener('status', (e) => onStatus?.(JSON.parse(e.data)));
  es.addEventListener('notify', (e) => onNotify?.(JSON.parse(e.data)));
  es.onopen = () => onOpen?.();
  es.onerror = () => onError?.();
  return es;
}
