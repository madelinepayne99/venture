// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type * as T from "three";
import { MARKS, walkable } from "../components/founders-desk/world/layout";
const capture = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }));
vi.mock('../components/founders-desk/world/softwareRenderer', () => ({
  SoftwareRenderer: class {
    domElement = document.createElement('canvas'); shadowMap = { enabled: false, type: 0 }; outputColorSpace = ''; toneMapping = 0; toneMappingExposure = 1;
    setPixelRatio() {} setSize() {} invalidate() {} render = capture.render; dispose = capture.dispose;
  },
}));
import { createOfficeWorld, type WorldEngine } from '../components/founders-desk/world/engine';

/**
 * Real engine-level behavior tests (Milestone 8 integration), ported from
 * the approved "Living Polish" redesign's own `livingEngine.test.ts` and
 * extended for all seven agents — see docs/operations-build-progress.md
 * for the full integration account. A mocked renderer + fake clock mean
 * this exercises the REAL engine tick loop (movement, collision
 * avoidance, idle wandering, interruption by real work, screen
 * expressions) without needing WebGL or a real browser — the strongest
 * verification available for the 3D scene's runtime behavior in a
 * sandbox with no browser-automation tool.
 *
 * Every `syncWorld(...)` call below passes `agentTasks` explicitly
 * (even when empty) before `snap` — a real adaptation needed here: the
 * original patch's own calls assumed a 4-argument signature
 * (missions, leadAssignments, contentItems, snap); Milestone 7 inserted
 * `agentTasks` as a 4th parameter before `snap`, so porting the original
 * `engine.syncWorld([],[],[],true)` verbatim would have silently passed
 * `true` as `agentTasks` (wrong type) and left `snap` defaulting to
 * `false` — caught and fixed here, not shipped.
 */
let frame: FrameRequestCallback | undefined, time = 0, engine: WorldEngine, host: HTMLDivElement, reduced = false, motion: () => void;
function step(seconds: number) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { time += 1000 / 60; frame?.(time); } }
function rig(key: string): T.Object3D { const scene = capture.render.mock.calls.at(-1)![0] as T.Scene; return scene.children.find(o => o.userData.target === key)!; }

beforeEach(() => {
  time = 0; reduced = false; capture.render.mockClear(); capture.dispose.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1; }); vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: (_: string, cb: () => void) => { motion = cb; }, removeEventListener() {} }));
  // Canvas drawing is deliberately stubbed for engine/state tests, never presented as a visual check.
  const gradient = { addColorStop() {} };
  const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: (s: string) => ({ width: s.length * 12 }) }, { get: (target, p) => p in target ? target[p as keyof typeof target] : () => {}, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => kind === '2d' ? context : null) as never);
  host = document.createElement('div'); Object.defineProperty(host, 'clientWidth', { value: 1440 }); Object.defineProperty(host, 'clientHeight', { value: 800 }); document.body.appendChild(host);
  engine = createOfficeWorld(host, { onSelect: () => {} }); engine.syncWorld([], [], [], [], true); step(.02);
});
afterEach(() => { engine.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const missions = [{ id: 'r', state: 'researching', title: 'Research' }, { id: 'c', state: 'ready_for_founders_review', title: 'Real title' }];
const leads = [{ mission_id: 'r', agent_key: 'scout' }, { mission_id: 'c', agent_key: 'content_bot' }];

describe('office life engine (no database or providers)', () => {
  it('wanders independently for three minutes without body overlap or leaving the floor', () => {
    const initial = rig('scout').position.clone(); let smallest = Infinity;
    for (let i = 0; i < 180; i++) {
      step(1);
      const a = rig('scout').position, b = rig('content_bot').position;
      smallest = Math.min(smallest, Math.hypot(a.x - b.x, a.z - b.z));
      expect(walkable(a)).toBe(true); expect(walkable(b)).toBe(true);
    }
    expect(smallest).toBeGreaterThanOrEqual(.72); expect(rig('scout').position.distanceTo(initial)).toBeGreaterThan(.2);
  });
  it('interrupts leisure with independent work, settles both, then returns to idle', () => {
    step(10); engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], []); step(50);
    expect(rig('scout').position.x).toBeCloseTo(MARKS.research.x); expect(rig('content_bot').position.x).toBeCloseTo(MARKS.studio.x);
    expect(host.dataset.studioState).toBe('generating');
    engine.syncWorld([{ id: 'r', state: 'failed' }, { id: 'c', state: 'ready_for_founders_review' }], leads, [{ mission_id: 'c', state: 'awaiting_review' }], []); step(22);
    expect(host.dataset.studioState).toBe('awaiting_review'); expect(rig('content_bot').position.x).toBeLessThan(5);
    expect(host.querySelector('[data-world-target="content_bot"]')?.textContent).not.toContain('Producing');
  });
  it('places agents directly on first/snap snapshots, even when several are working', () => {
    const agentTasks = [{ agent_key: 'finance_agent', state: 'open', goal_id: null }];
    engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], agentTasks, true); step(.1);
    expect(rig('scout').position.x).toBe(MARKS.research.x); expect(rig('content_bot').position.x).toBe(MARKS.studio.x);
    expect(rig('finance_agent').position.x).toBe(MARKS.ledger.x);
    expect(host.querySelector('[data-world-target="content_bot"]')?.textContent).toContain('Producing');
  });
  it('stops wandering and snaps real work under reduced motion, including mid-session', () => {
    reduced = true; motion(); const p = rig('scout').position.clone(); step(25); expect(rig('scout').position.toArray()).toEqual(p.toArray());
    engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], []); step(.1); expect(rig('content_bot').position.x).toBe(MARKS.studio.x);
  });
  it('keeps a polling refresh of unchanged state from replaying the journey', () => {
    engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], []); step(1); const p = rig('content_bot').position.clone();
    engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], []); expect(rig('content_bot').position.toArray()).toEqual(p.toArray());
  });
  it('disposes the renderer and removes the scene controls on unmount', () => {
    engine.dispose(); expect(capture.dispose).toHaveBeenCalled(); expect(host.children.length).toBe(0);
  });

  // --- Operations Wing (Milestone 7/8) --------------------------------
  it('a real agent_tasks row moves its own Operations Wing agent to its desk — and nowhere else', () => {
    step(5);
    engine.syncWorld([], [], [], [{ agent_key: 'operations_agent', state: 'open', goal_id: null }]);
    step(30);
    expect(rig('operations_agent').position.x).toBeCloseTo(MARKS.process.x);
    expect(rig('operations_agent').position.z).toBeCloseTo(MARKS.process.z);
    // No other agent (including the other four Operations Wing agents) is
    // pulled to its own desk — each desk/home pair shares an x but differs
    // in z (see layout.ts's MARKS), so z is the real discriminator here.
    expect(rig('chief_of_staff').position.z).not.toBeCloseTo(MARKS.command.z, 0);
    expect(rig('finance_agent').position.z).not.toBeCloseTo(MARKS.ledger.z, 0);
  });
  it('completing the real task sends the Operations Wing agent back home', () => {
    engine.syncWorld([], [], [], [{ agent_key: 'business_analyst', state: 'open', goal_id: null }], true);
    step(.1);
    expect(rig('business_analyst').position.x).toBe(MARKS.intel.x);
    engine.syncWorld([], [], [], [{ agent_key: 'business_analyst', state: 'completed', goal_id: null }]);
    step(30);
    expect(rig('business_analyst').position.x).toBeCloseTo(MARKS.businessAnalystHome.x);
  });
  it("Chief of Staff genuinely reaches its desk from a real delegated (goal_id-bearing) subtask — a row naming it directly (goal_id: null) is proven NOT to drive this at the pure-function level in tests/officeWorld.test.ts; this only re-confirms the positive, engine-level case (Chief of Staff's own idle itinerary ALSO legitimately visits its desk as a leisure stop — same pattern as Scout's 'At home desk' idle visit — so position alone can't distinguish idle-visiting from genuinely busy here)", () => {
    engine.syncWorld([], [], [], [{ agent_key: 'executive_assistant', state: 'open', goal_id: 'goal-1' }], true);
    step(.1);
    expect(rig('chief_of_staff').position.x).toBeCloseTo(MARKS.command.x);
    expect(rig('chief_of_staff').position.z).toBeCloseTo(MARKS.command.z);
    engine.syncWorld([], [], [], [{ agent_key: 'executive_assistant', state: 'completed', goal_id: 'goal-1' }]);
    step(30);
    expect(rig('chief_of_staff').position.z).toBeCloseTo(MARKS.chiefOfStaffHome.z);
  });
  it('seven agents can be genuinely busy at once, each independently, with no body overlap', () => {
    const agentTasks = [
      { agent_key: 'chief_of_staff', state: 'open', goal_id: 'g1' },
      { agent_key: 'executive_assistant', state: 'open', goal_id: null },
      { agent_key: 'finance_agent', state: 'open', goal_id: null },
      { agent_key: 'business_analyst', state: 'open', goal_id: null },
      { agent_key: 'operations_agent', state: 'open', goal_id: null },
    ];
    engine.syncWorld(missions, leads, [{ mission_id: 'c', state: 'generating' }], agentTasks, true);
    step(1);
    const positions = ['scout', 'content_bot', 'chief_of_staff', 'executive_assistant', 'finance_agent', 'business_analyst', 'operations_agent']
      .map(key => rig(key).position);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      expect(positions[i]!.distanceTo(positions[j]!)).toBeGreaterThan(.1);
    }
    expect(rig('scout').position.x).toBe(MARKS.research.x);
    expect(rig('content_bot').position.x).toBe(MARKS.studio.x);
    expect(rig('chief_of_staff').position.x).toBe(MARKS.command.x);
    expect(rig('executive_assistant').position.x).toBe(MARKS.admin.x);
    expect(rig('finance_agent').position.x).toBe(MARKS.ledger.x);
    expect(rig('business_analyst').position.x).toBe(MARKS.intel.x);
    expect(rig('operations_agent').position.x).toBe(MARKS.process.x);
  });
  it('wanders independently near its own desk without overlapping a neighbor, over an extended idle period', () => {
    step(5);
    let smallest = Infinity;
    for (let i = 0; i < 90; i++) {
      step(1);
      const a = rig('finance_agent').position, b = rig('business_analyst').position;
      smallest = Math.min(smallest, Math.hypot(a.x - b.x, a.z - b.z));
      expect(walkable(a)).toBe(true); expect(walkable(b)).toBe(true);
    }
    expect(smallest).toBeGreaterThanOrEqual(.72);
  });
});
