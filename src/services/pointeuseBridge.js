const BRIDGE_URL = import.meta.env?.VITE_POINTAGE_BRIDGE_URL || 'http://127.0.0.1:8787';

export async function readPointeuseAttendance(from, through, signal) {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}/v1/attendance`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pointage-Client': 'rh' },
      body: JSON.stringify({ from, through }), signal, cache: 'no-store', credentials: 'omit' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Object.assign(new Error('bridge_unavailable'), { code: 'bridge_unavailable' });
  }
  const data = await response.json();
  if (data.protocol !== 'myc-pointage-bridge-v1') throw Object.assign(new Error('bridge_unavailable'), { code: 'bridge_unavailable' });
  if (!response.ok || !data.ok) {
    const code = data.code || (data.devices?.some((device) => device.code === 'communication_key') ? 'communication_key' : 'unreachable');
    throw Object.assign(new Error(code), { code });
  }
  if (!Array.isArray(data.records) || !Array.isArray(data.devices)) throw new Error('Invalid attendance response');
  return data;
}
