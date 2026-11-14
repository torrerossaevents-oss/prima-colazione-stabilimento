/**
 * Banco di prova SIMULATO: PLC simulato (Modbus su 127.0.0.1) + gestionale finto (HTTP su
 * 127.0.0.1) + servizio ponte reale, con orologio virtuale. Usato da simulate.mjs,
 * dalla modalità `--simulazione` del servizio e dai test. Nessun dato reale.
 */
import { SimulatedPlc, simulationServiceConfig } from './sim-plc.mjs';
import { FakeGestionale } from './sim-gestionale.mjs';
import { validateServiceConfig } from './config.mjs';
import { ModbusPlc } from './plc.mjs';
import { BridgeService } from './service.mjs';

export const SIM_TOKEN = 'pcd_SIMULAZIONE_NON_E_UN_TOKEN_REALE';
export const SIM_LINE = 'linea-simulazione';

export async function createSimulation({ dataDir, cumulative = 65_400, patch = c => c, realTime = false, echo = false }) {
  const clock = { t: Date.parse('2026-11-13T07:00:00.000Z') };
  const now = realTime ? () => { clock.t = Math.max(clock.t, Date.now()); return clock.t; } : () => clock.t;
  if (realTime) now();
  const plc = new SimulatedPlc({ cumulative, clock });
  await plc.listen();
  const gestionale = new FakeGestionale({ token: SIM_TOKEN, line: SIM_LINE });
  const baseUrl = await gestionale.listen();
  const config = validateServiceConfig(patch(simulationServiceConfig({ plc, baseUrl, line: SIM_LINE })), { allowLoopback: true });
  let service = null;
  const sim = {
    clock, plc, gestionale, config, now,
    get service() { return service; },
    start() { service = new BridgeService({ config, token: SIM_TOKEN, dataDir, plc: new ModbusPlc(config.plc), now, echo }); return service; },
    /** Simula lo spegnimento del PC: il processo si ferma senza altro salvataggio. */
    restart() { service.dispose('Simulazione: processo fermato (riavvio del PC simulato).'); return sim.start(); },
    advance(ms) { clock.t += ms; },
    async cycle(times = 1, stepMs = 250) { for (let i = 0; i < times; i++) { sim.advance(stepMs); await service.cycle(); } },
    cartons(n, kind = 'passCarton') { for (let i = 0; i < n; i++) plc[kind](); },
    async close() { service?.dispose(); await plc.close(); await gestionale.close(); },
  };
  return sim;
}
