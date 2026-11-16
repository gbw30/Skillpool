"use client";

// The landing page's 3D scene, drawn with three.js. In the hero it is a brain-shaped neural mesh:
// the real people, projects and skills are some of its points, signals run along its links, and
// a point flares when one arrives. As the page scrolls, the real nodes leave the brain for their
// places in the real graph, the rest of the mesh dissolves, and the graph can be explored.
// Everything here runs outside React, once per frame. Motion comes from exact springs (lib/spring).
// The scene is built unseen behind the loading screen, then starts where that screen drew the brain.
import { useEffect, useRef, type RefObject } from "react";
import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group,
  InstancedMesh, LineBasicMaterial, LineSegments, MeshLambertMaterial, NormalBlending, Object3D, OctahedronGeometry,
  PerspectiveCamera, Points, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLRenderer,
  type InterleavedBufferAttribute,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { brainPoints, nearestLinks } from "@/lib/brain";
import { createLayout, RADIUS, type Graph, type GraphNode, type Kind } from "@/lib/graph";
import { Spring } from "@/lib/spring";

/** What the page's own buttons can ask of the formed graph. */
export type GraphControls = { zoomBy: (factor: number) => void; reset: () => void };

type Props = {
  graph: Graph;
  /** Whether nodes can be hovered and opened. Off for the placeholder shape. */
  interactive: boolean;
  /** The element whose scroll position drives the change from brain to graph. It also receives the pointer events. */
  stage: RefObject<HTMLElement | null>;
  /** Node indexes to light up in order while the brain is showing, such as a person, their project and its skill. */
  trace: number[] | null;
  /** Filled in with the zoom controls while the scene exists. */
  controlsRef: RefObject<GraphControls | null>;
  onOpen: (person: GraphNode) => void;
  onUnsupported: () => void;
  /** While true the scene is built and drawn but stays unseen, so the page can bring everything in together. */
  held: boolean;
  /** The loading screen's drawing of the brain. The brain starts where it stands and travels to its own place. */
  sketch: RefObject<HTMLElement | null>;
  /** Called once the scene has drawn its first frame. */
  onReady: () => void;
  /** The hero's text. On a wide screen the brain rises from the bottom edge to just under it. */
  above: RefObject<HTMLElement | null>;
  /** Every node the hero will trace. On a wide screen they sit on the part of the brain that shows. */
  featured: number[];
};

const KINDS: Kind[] = ["person", "project", "skill"];
const FOV = 40;
const BRAIN_TOP = 0.84; // how far above its middle the brain's top is, in RADIUS, seen from the hero's side
const LABELS = 10;
const PULSES = 36; // few and slow: many quick signals read as flicker
const PICK_RADIUS = 16; // px around the pointer that counts as on a node
const ZOOM_MIN = 0.6, ZOOM_MAX = 10;
const LABEL_CLASS = "absolute left-0 top-0 hidden whitespace-nowrap rounded border bg-surface/85 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink";

const clamp = (x: number, low = 0, high = 1) => Math.min(Math.max(x, low), high);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => x * x * (3 - 2 * x);
const any = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// Round soft dots: a core and a faint halo. `energy` warms a dot a little after a signal arrives.
// It changes slowly and by a small amount, so nothing on screen flashes.
const DOT_VERTEX = `
  attribute vec3 tint;
  attribute float scale;
  attribute float energy;
  attribute float fade;
  uniform float pixel;
  uniform float fogNear;
  uniform float fogFar;
  uniform float boost;
  varying vec3 vTint;
  varying float vFade;
  void main() {
    vec4 eye = modelViewMatrix * vec4(position, 1.0);
    float depth = -eye.z;
    gl_PointSize = scale * (1.0 + energy * 0.22) * pixel / depth;
    vTint = tint * (0.58 + energy * 0.3 * boost);
    vFade = fade * (1.0 - 0.85 * smoothstep(fogNear, fogFar, depth));
    gl_Position = projectionMatrix * eye;
  }`;
const DOT_FRAGMENT = `
  varying vec3 vTint;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.42, 0.12, d);
    float halo = pow(1.0 - d, 2.4);
    gl_FragColor = vec4(vTint, (core * 0.9 + halo * 0.25) * vFade);
    #include <colorspace_fragment>
  }`;

function dotMaterial() {
  return new ShaderMaterial({
    uniforms: { pixel: { value: 1 }, fogNear: { value: 1 }, fogFar: { value: 100 }, boost: { value: 1 } },
    vertexShader: DOT_VERTEX, fragmentShader: DOT_FRAGMENT, transparent: true, depthWrite: false,
  });
}

export function GraphCanvas({ graph, interactive, stage, trace, controlsRef, onOpen, onUnsupported, held, sketch, onReady, above, featured }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  // The latest props the scene reads, so a change in them does not rebuild it.
  const latest = useRef({ onOpen, onUnsupported, onReady, held, trace });
  const scene = useRef<{ trace: (path: number[] | null) => void } | null>(null);
  useEffect(() => {
    latest.current = { onOpen, onUnsupported, onReady, held, trace };
    scene.current?.trace(trace);
  });

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current, labelLayer = labelsRef.current, stageEl = stage.current;
    if (!container || !canvas || !labelLayer || !stageEl) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      latest.current.onUnsupported();
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { nodes, links } = graph;
    const n = nodes.length, m = links.length;
    // The brain needs many more points than the graph has nodes; the rest are filler neurons.
    const total = Math.max(container.clientWidth < 640 ? 520 : 900, Math.ceil(n * 1.4));

    // --- scene -----------------------------------------------------------------------------
    const world = new Scene();
    const fog = new Fog(0x000000, 1, 100);
    world.fog = fog;
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 400);
    world.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(0.4, 1, 0.8);
    world.add(sun);
    // `outer` places the shape and flattens it towards the viewer; `inner` turns and grows it.
    const outer = new Group(), inner = new Group();
    outer.add(inner);
    world.add(outer);

    // Solid shapes for the real nodes, shown once the graph has formed: sphere, diamond, cube.
    const shapes = { person: new SphereGeometry(0.2, 16, 12), project: new OctahedronGeometry(0.44), skill: new BoxGeometry(0.34, 0.34, 0.34) };
    const meshOf: number[] = [], slotOf: number[] = [];
    const counts = [0, 0, 0];
    for (const node of nodes) {
      const k = KINDS.indexOf(node.kind);
      meshOf.push(k);
      slotOf.push(counts[k]++);
    }
    const solid = new MeshLambertMaterial({ flatShading: true }); // each node's colour is set per instance
    const solids = KINDS.map((kind, k) => {
      const item = new InstancedMesh(shapes[kind], solid, counts[k]);
      item.frustumCulled = false;
      item.visible = false;
      inner.add(item);
      return item;
    });
    // Busier projects and skills are drawn larger.
    const size = nodes.map((node) => (node.kind === "person" ? 1 : 1 + Math.min(node.neighbours.length, 12) * 0.05));

    const dotGeometry = new BufferGeometry(), meshGeometry = new BufferGeometry(), linkGeometry = new BufferGeometry();
    const traceGeometry = new BufferGeometry(), pulseGeometry = new BufferGeometry();
    const dotMat = dotMaterial(), pulseMat = dotMaterial();
    const meshMat = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const linkMat = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const traceMat = new LineBasicMaterial({ transparent: true, depthWrite: false });
    const dots = new Points(dotGeometry, dotMat), pulses = new Points(pulseGeometry, pulseMat);
    const meshLines = new LineSegments(meshGeometry, meshMat), linkLines = new LineSegments(linkGeometry, linkMat);
    const traceLines = new LineSegments(traceGeometry, traceMat);
    // The hero's traced path is drawn as a thick line, which plain WebGL lines cannot be. Room for four segments.
    const pathGeometry = new LineSegmentsGeometry().setPositions(new Float32Array(24));
    const pathMat = new LineMaterial({ linewidth: 3, transparent: true, depthWrite: false });
    const pathLines = new LineSegments2(pathGeometry, pathMat);
    const pathArray = pathGeometry.attributes.instanceStart.array as Float32Array;
    pathLines.frustumCulled = false;
    pathLines.visible = false;
    inner.add(pathLines);
    for (const object of [meshLines, linkLines, traceLines, dots, pulses]) {
      object.frustumCulled = false;
      object.visible = false; // until the layout is ready
      inner.add(object);
    }

    // --- colours follow the page theme -----------------------------------------------------
    const probe = document.createElement("span");
    probe.hidden = true;
    container.append(probe);
    const token = (name: string) => {
      probe.style.color = `var(${name})`;
      return new Color(getComputedStyle(probe).color);
    };
    const palette = { person: new Color(), project: new Color(), skill: new Color() };
    const background = new Color(), ink = new Color();
    let dark = true;

    // --- positions: the brain, the graph, and where each point is now ----------------------
    const layout = createLayout(graph);
    const graphAt = layout.positions; // the real nodes' places in the real graph
    let home = new Float32Array(total * 3); // every point's place in the brain; the first n are the real nodes
    const here = new Float32Array(total * 3); // where each point is this frame
    let mesh: [number, number][] = [];
    let meshNext: number[][] = [];
    const kindOf = new Uint8Array(total), delay = new Float32Array(total), dotSize = new Float32Array(total);
    const tint = new Float32Array(total * 3), scale = new Float32Array(total), energy = new Float32Array(total), fade = new Float32Array(total);
    const warmth = new Float32Array(total); // what `energy` is easing towards; set when a signal arrives, then fades
    let meshPositions = new Float32Array(0), meshColors = new Float32Array(0);
    const linkPositions = new Float32Array(m * 6), linkColors = new Float32Array(m * 6);
    const tracePositions = new Float32Array(Math.max(m, 8) * 6);

    const pulseCount = reduced ? 0 : PULSES;
    const pulsePositions = new Float32Array(pulseCount * 3), pulseTint = new Float32Array(pulseCount * 3);
    const pulseScale = new Float32Array(pulseCount).fill(0.32), pulseEnergy = new Float32Array(pulseCount), pulseFade = new Float32Array(pulseCount);
    const pulseFrom = new Int32Array(pulseCount), pulseTo = new Int32Array(pulseCount);
    const pulsePhase = new Float32Array(pulseCount), pulseSpeed = new Float32Array(pulseCount);
    const pulseOnGraph = new Uint8Array(pulseCount);

    const dummy = new Object3D(), colour = new Color(), point = new Vector3();
    let ready = false, announced = false;
    let shownAt = Infinity; // when the page let the scene be seen
    let hovered = -1;
    let formed = 0; // 0 while the brain shows, 1 once the graph has formed

    /** Send a signal off from somewhere new: along the real links once the graph has formed, else along the mesh. */
    function launch(k: number, onGraph: boolean) {
      pulseOnGraph[k] = onGraph ? 1 : 0;
      if (onGraph && m > 0) {
        const [a, b] = any(links);
        [pulseFrom[k], pulseTo[k]] = Math.random() < 0.5 ? [a, b] : [b, a];
        pulseSpeed[k] = 0.22 + Math.random() * 0.22;
      } else {
        const a = Math.floor(Math.random() * total);
        pulseFrom[k] = a;
        pulseTo[k] = meshNext[a].length ? any(meshNext[a]) : a;
        pulseSpeed[k] = 0.35 + Math.random() * 0.35;
      }
      pulsePhase[k] = 0;
    }

    /** Colours for the current theme and hover: the hovered node and its neighbours stay lit. */
    function paint() {
      const lit = hovered === -1 ? null : new Set([hovered, ...nodes[hovered].neighbours]);
      for (let i = 0; i < total; i++) {
        colour.copy(palette[KINDS[kindOf[i]]]);
        if (i >= n) colour.lerp(background, dark ? 0.35 : 0.2); // filler neurons sit back a little
        else if (lit && !lit.has(i)) colour.lerp(background, 0.85);
        colour.toArray(tint, i * 3);
        if (i < n) solids[meshOf[i]].setColorAt(slotOf[i], colour);
      }
      links.forEach(([a, b], k) => {
        for (const [end, offset] of [[a, 0], [b, 3]]) {
          colour.copy(palette[nodes[end].kind]);
          if (lit) colour.lerp(background, 0.75);
          colour.toArray(linkColors, k * 6 + offset);
        }
      });
      mesh.forEach(([a, b], k) => {
        meshColors.set(tint.subarray(a * 3, a * 3 + 3), k * 6);
        meshColors.set(tint.subarray(b * 3, b * 3 + 3), k * 6 + 3);
      });
      colour.copy(palette.person).lerp(ink, dark ? 0.35 : 0);
      for (let k = 0; k < pulseCount; k++) colour.toArray(pulseTint, k * 3);
      dotGeometry.attributes.tint.needsUpdate = true;
      linkGeometry.attributes.color.needsUpdate = true;
      meshGeometry.attributes.color.needsUpdate = true;
      if (pulseCount) pulseGeometry.attributes.tint.needsUpdate = true;
      for (const item of solids) if (item.instanceColor) item.instanceColor.needsUpdate = true;
    }

    function applyTheme() {
      background.copy(token("--color-bg"));
      ink.copy(token("--color-ink"));
      for (const kind of KINDS) palette[kind].copy(token(`--color-${kind}`));
      dark = background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
      fog.color.copy(background);
      // Light adds up on a dark page and would wash out on a light one.
      for (const material of [dotMat, pulseMat, meshMat, linkMat]) {
        material.blending = dark ? AdditiveBlending : NormalBlending;
        material.needsUpdate = true;
      }
      dotMat.uniforms.boost.value = pulseMat.uniforms.boost.value = dark ? 1 : 0;
      traceMat.color.copy(ink);
      pathMat.color.copy(token("--color-accent"));
      if (ready) paint();
    }

    // --- the hero's traced path: a person, their project, its skill, lit one after the other -
    let path: number[] = [];
    let reach = new Spring(0, 2.8); // how far along the path the light has travelled; slow enough to follow
    function setTrace(next: number[] | null) {
      const wanted = (next ?? []).filter((i) => i >= 0 && i < n);
      if (wanted.join() === path.join()) return;
      path = wanted;
      reach = new Spring(0, 2.8);
      reach.to(Math.max(path.length - 1, 0), performance.now() / 1000);
      if (ready) label();
    }
    scene.current = { trace: setTrace };

    function build() {
      // Give each real node the nearest free point of the brain, so its trip to the graph is short.
      // On a wide screen only the brain's top shows, so the nodes the hero traces choose first, and
      // from the points that are in view there, on the side the camera sees.
      const cloud = brainPoints(total);
      const w = container!.clientWidth, h = container!.clientHeight;
      measure();
      const away = horizonAway(w / h), middle = horizonY(away, h);
      /** Whether a point of the brain stays on screen in the wide hero, clear of the bottom edge, at both ends of the sway. */
      const showing = (j: number) => [-0.3, 0, 0.3].every((sway) => {
        const turned = -Math.PI / 2 + 0.4 + sway;
        const depth = -cloud[j * 3] * Math.sin(turned) + cloud[j * 3 + 2] * Math.cos(turned); // towards the camera
        return depth > -RADIUS * 0.2 && (middle + cloud[j * 3 + 1] - 0.1 * depth) / (slope * (away - depth)) > -0.68;
      });
      const taken = new Uint8Array(total);
      const order: number[] = new Array(n);
      const first = w >= 1024 ? [...new Set(featured)].filter((i) => i >= 0 && i < n) : [];
      const turns = [...first, ...nodes.map((_, i) => i).filter((i) => !first.includes(i))];
      turns.forEach((i, turn) => {
        let best = 0, nearest = Infinity;
        for (let j = 0; j < total; j++) {
          if (taken[j]) continue;
          const hidden = turn < first.length && !showing(j);
          const gap = (cloud[j * 3] - graphAt[i * 3]) ** 2 + (cloud[j * 3 + 1] - graphAt[i * 3 + 1]) ** 2 + (cloud[j * 3 + 2] - graphAt[i * 3 + 2]) ** 2 + (hidden ? 1e9 : 0);
          if (gap < nearest) {
            nearest = gap;
            best = j;
          }
        }
        taken[best] = 1;
        order[i] = best;
      });
      for (let j = 0; j < total; j++) if (!taken[j]) order.push(j);
      home = new Float32Array(total * 3);
      order.forEach((from, to) => home.set(cloud.subarray(from * 3, from * 3 + 3), to * 3));
      here.set(home);

      mesh = nearestLinks(home, 3);
      meshNext = Array.from({ length: total }, () => []);
      for (const [a, b] of mesh) {
        meshNext[a].push(b);
        meshNext[b].push(a);
      }
      meshPositions = new Float32Array(mesh.length * 6);
      meshColors = new Float32Array(mesh.length * 6);

      for (let i = 0; i < total; i++) {
        // Filler neurons take the three kinds' colours too, mostly the people's.
        const roll = Math.random();
        kindOf[i] = i < n ? KINDS.indexOf(nodes[i].kind) : roll < 0.6 ? 0 : roll < 0.78 ? 1 : 2;
        delay[i] = Math.random();
        dotSize[i] = i < n ? [0.5, 0.78, 0.62][kindOf[i]] : 0.26 + Math.random() * 0.2;
        fade[i] = 1;
      }

      dotGeometry.setAttribute("position", new BufferAttribute(here, 3));
      dotGeometry.setAttribute("tint", new BufferAttribute(tint, 3));
      dotGeometry.setAttribute("scale", new BufferAttribute(scale, 1));
      dotGeometry.setAttribute("energy", new BufferAttribute(energy, 1));
      dotGeometry.setAttribute("fade", new BufferAttribute(fade, 1));
      meshGeometry.setAttribute("position", new BufferAttribute(meshPositions, 3));
      meshGeometry.setAttribute("color", new BufferAttribute(meshColors, 3));
      linkGeometry.setAttribute("position", new BufferAttribute(linkPositions, 3));
      linkGeometry.setAttribute("color", new BufferAttribute(linkColors, 3));
      traceGeometry.setAttribute("position", new BufferAttribute(tracePositions, 3));
      traceGeometry.setDrawRange(0, 0);
      pulseGeometry.setAttribute("position", new BufferAttribute(pulsePositions, 3));
      pulseGeometry.setAttribute("tint", new BufferAttribute(pulseTint, 3));
      pulseGeometry.setAttribute("scale", new BufferAttribute(pulseScale, 1));
      pulseGeometry.setAttribute("energy", new BufferAttribute(pulseEnergy, 1));
      pulseGeometry.setAttribute("fade", new BufferAttribute(pulseFade, 1));
      for (let k = 0; k < pulseCount; k++) {
        launch(k, false);
        pulsePhase[k] = Math.random();
      }
      for (const object of [dots, pulses, traceLines]) object.visible = true;
      ready = true;
      applyTheme();
      path = [];
      setTrace(latest.current.trace);
      label();
    }

    // --- labels: HTML over the canvas, so the text stays sharp ------------------------------
    const labels = Array.from({ length: LABELS }, () => {
      const el = document.createElement("div");
      labelLayer.append(el);
      return el;
    });
    const busiest = nodes.map((node, i) => ({ node, i })).filter(({ node }) => node.kind === "project")
      .sort((a, b) => b.node.neighbours.length - a.node.neighbours.length).map(({ i }) => i);
    let labelled: number[] = [];

    /** Which nodes carry a label: in the brain, the traced path; in the graph, the hovered node and its neighbours, else the busiest projects. */
    function label() {
      const inBrain = formed < 0.5;
      labelled = inBrain ? path
        : !interactive ? []
        : hovered !== -1 ? [hovered, ...nodes[hovered].neighbours].slice(0, LABELS)
        : busiest.slice(0, container!.clientWidth < 640 ? 3 : 6);
      labels.forEach((el, k) => {
        const node = nodes[labelled[k]];
        el.className = `${LABEL_CLASS} ${inBrain || labelled[k] === hovered ? "z-10 border-accent" : "border-line"}`;
        el.textContent = node ? (labelled[k] === hovered ? `${node.name} · ${node.kind}` : node.name) : "";
      });
    }

    const onScreen = (i: number) => point.set(here[i * 3], here[i * 3 + 1], here[i * 3 + 2]).applyMatrix4(inner.matrixWorld).project(camera);
    let width = 0, height = 0;

    // Where the hero's text ends, in px below the stage's top. Read from offsets, not a bounding
    // box: the text slides in on a transform, which must not move the brain.
    const aboveEl = above.current;
    let textEnd = 0;
    function measure() {
      if (!aboveEl) return;
      textEnd = aboveEl.offsetHeight;
      for (let el: HTMLElement | null = aboveEl; el && el !== stageEl; el = el.offsetParent as HTMLElement | null) textEnd += el.offsetTop;
    }
    const watching = new ResizeObserver(measure);
    if (aboveEl) watching.observe(aboveEl);

    // The wide hero ("Horizon"): the brain is wider than the window and its middle is below the
    // bottom edge, so only its top rises into view, just under the hero's text.
    const slope = Math.tan((FOV / 2) * (Math.PI / 180));
    /** The camera's distance. The height share stops a very wide, short window from bringing it into the brain. */
    const horizonAway = (aspect: number) => (RADIUS / slope) * Math.max(1 / (1.04 * aspect), 1 / 1.75);
    /** The share of the view's height at which the hero's text ends. */
    const textShareOf = (h: number) => (aboveEl ? Math.min(1, textEnd / h) : 0.55);
    /** How high the brain's middle is, for its top to sit a little under the text. */
    const horizonY = (away: number, h: number) => slope * away * (1 - 2 * clamp(textShareOf(h) + 28 / h, 0.5, 0.74)) - RADIUS * BRAIN_TOP;

    // --- the entrance: the picture starts small, at `enter`, and grows into its place ----------
    const arrive = new Spring(1, 1.15, 0.1); // 0 where the entrance starts, 1 in place
    // The starting size (1 is life size) and middle, in canvas pixels. `drawn`: it starts on the loading screen's drawing.
    let enter = { size: 1, x: 0, y: 0, drawn: false };
    const place = { x: 0, y: 0 }; // the brain's middle on the canvas, at rest

    /** The scene may now be seen. Start it on the loading screen's drawing if there is one, else a little smaller than life. */
    function begin(t: number, e: number) {
      // The trace starts over, so the visitor sees it from its first step.
      reach = new Spring(0, 2.8);
      reach.to(Math.max(path.length - 1, 0), t + 0.6);
      if (reduced) return; // no movement: the scene fades in where it rests
      // The brain's outline on the canvas, as it rests.
      camera.clearViewOffset();
      camera.updateMatrixWorld();
      outer.updateMatrixWorld(true);
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (let i = 0; i < total; i++) {
        const p = onScreen(i);
        const x = (p.x * 0.5 + 0.5) * width, y = (-p.y * 0.5 + 0.5) * height;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      place.x = (left + right) / 2;
      place.y = (top + bottom) / 2;
      // Scrolled down, the brain is already on its way to being the graph, and the drawing is not of that.
      const drawing = e < 0.02 ? sketch.current?.getBoundingClientRect() : undefined;
      arrive.jump(0);
      if (drawing && drawing.width > 0 && right > left) {
        const box = canvas!.getBoundingClientRect();
        enter = {
          size: Math.min(drawing.width / (right - left), drawing.height / (bottom - top)),
          x: drawing.left + drawing.width / 2 - box.left, y: drawing.top + drawing.height / 2 - box.top, drawn: true,
        };
        arrive.to(1, t + 0.3); // the drawing fades into the brain first, then the brain sets off
      } else {
        enter = { size: 0.7, x: place.x, y: place.y, drawn: false };
        arrive.to(1, t);
      }
    }

    /** The real node under a point on the canvas, or -1. Works on screen positions, so small nodes are easy to hit. */
    function pick(x: number, y: number) {
      let best = -1, nearest = PICK_RADIUS * PICK_RADIUS;
      for (let i = 0; i < n; i++) {
        const p = onScreen(i);
        if (p.z > 1) continue;
        const dx = (p.x * 0.5 + 0.5) * width - x, dy = (-p.y * 0.5 + 0.5) * height - y;
        if (dx * dx + dy * dy < nearest) {
          nearest = dx * dx + dy * dy;
          best = i;
        }
      }
      return best;
    }

    // --- pointer ---------------------------------------------------------------------------
    let yaw = 0, pitch = 0;
    let drag: { x: number; y: number; moved: number; turn: boolean } | null = null;
    const usable = () => interactive && ready && formed > 0.85;
    const onControl = (event: Event) => event.target instanceof Element && event.target.closest("a, button, input, summary, details") !== null;
    const onCanvas = (event: MouseEvent) => {
      const box = canvas.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top] as const;
    };
    // The shape leans a little towards the pointer while the brain shows.
    const leanX = new Spring(0, 0.9), leanY = new Spring(0, 0.9);

    // --- zoom and pan, once the graph has formed --------------------------------------------
    const zoom = new Spring(1, 0.35), panX = new Spring(0, 0.35), panY = new Spring(0, 0.35);
    // Set each frame, in world units at the graph: where its middle rests, and half the view's size.
    const rest = { x: 0, y: 0 }, half = { x: 1, y: 1 };

    /** Zoom by `factor`, keeping the spot at (x, y) on the canvas where it is. With no spot given, the middle of the view. */
    function zoomBy(factor: number, x = width / 2, y = height / 2) {
      const from = zoom.target, to = clamp(from * factor, ZOOM_MIN, ZOOM_MAX);
      if (to === from || width === 0) return;
      const t = performance.now() / 1000;
      // The spot, measured from the graph's resting middle. It stays put if pan' = spot - (spot - pan) * to / from.
      const sx = ((x / width) * 2 - 1) * half.x - rest.x, sy = (1 - (y / height) * 2) * half.y - rest.y;
      panX.to(sx - (sx - panX.target) * (to / from), t);
      panY.to(sy - (sy - panY.target) * (to / from), t);
      zoom.to(to, t);
    }
    function resetView() {
      const t = performance.now() / 1000;
      zoom.to(1, t);
      panX.to(0, t);
      panY.to(0, t);
      yaw = pitch = 0;
    }
    controlsRef.current = { zoomBy: (factor) => { if (usable()) zoomBy(factor); }, reset: resetView };

    function hover(i: number) {
      if (i === hovered) return;
      hovered = i;
      stageEl!.style.cursor = i !== -1 && nodes[i].kind === "person" ? "var(--cursor-link)" : "";
      paint();
      label();
    }

    const onPointerMove = (event: PointerEvent) => {
      const t = performance.now() / 1000;
      leanX.to(((event.clientY / innerHeight) * 2 - 1) * 0.1, t);
      leanY.to(((event.clientX / innerWidth) * 2 - 1) * 0.16, t);
      if (drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (drag.turn) {
          yaw += dx * 0.006;
          pitch = clamp(pitch + dy * 0.006, -1, 1);
        } else {
          // The graph follows the pointer exactly, so a drag has no spring.
          panX.jump(panX.target + (dx / width) * 2 * half.x);
          panY.jump(panY.target - (dy / height) * 2 * half.y);
        }
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      }
      hover(usable() && !onControl(event) ? pick(...onCanvas(event)) : -1);
    };
    const onPointerDown = (event: PointerEvent) => {
      // Dragging moves the graph, and turns it with Shift held. Mouse only: on a touch screen the
      // same gesture scrolls the page.
      if (!usable() || event.pointerType !== "mouse" || event.button !== 0 || onControl(event)) return;
      drag = { x: event.clientX, y: event.clientY, moved: 0, turn: event.shiftKey };
      stageEl.style.userSelect = "none";
    };
    let justDragged = false;
    const onPointerUp = () => {
      justDragged = (drag?.moved ?? 0) > 4;
      drag = null;
      stageEl.style.userSelect = "";
    };
    const onClick = (event: MouseEvent) => {
      if (justDragged || !usable() || onControl(event)) return;
      const i = pick(...onCanvas(event));
      // A tap on a touch screen has no hover first: the first tap shows the node, the second opens it.
      if (i !== hovered) return hover(i);
      if (i !== -1 && nodes[i].kind === "person") latest.current.onOpen(nodes[i]);
    };
    const onLeave = () => hover(-1);
    const onWheel = (event: WheelEvent) => {
      // Plain scrolling moves the page. Ctrl or Cmd with the wheel zooms the graph, and so does a
      // pinch on a trackpad, which browsers report the same way.
      if (!usable() || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.01), ...onCanvas(event));
    };
    stageEl.addEventListener("wheel", onWheel, { passive: false });
    stageEl.addEventListener("pointermove", onPointerMove);
    stageEl.addEventListener("pointerdown", onPointerDown);
    stageEl.addEventListener("pointerleave", onLeave);
    stageEl.addEventListener("click", onClick);
    addEventListener("pointerup", onPointerUp);

    const themeWatcher = new MutationObserver(applyTheme);
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const systemTheme = matchMedia("(prefers-color-scheme: dark)");
    systemTheme.addEventListener("change", applyTheme);

    // --- one frame -------------------------------------------------------------------------
    let frame = 0, last = performance.now() / 1000;
    const scrolled = new Spring(0, 0.7); // follows the page from the hero (0) to the graph view (1)
    let drift = 0, view = 0, veil = 1, wasFormed = false, drawn = -1, posed = "";
    // Writing a style the element already has still costs a style pass, so remember what was written.
    const written = new Map<HTMLElement, string>();
    const style = (el: HTMLElement, key: "opacity" | "transform" | "maskImage", value: string) => {
      if (written.get(el) === key + value) return;
      written.set(el, key + value);
      el.style[key] = value;
    };

    function tick(stamp: number) {
      frame = requestAnimationFrame(tick);
      const t = stamp / 1000, dt = clamp(t - last, 0, 0.1);
      last = t;

      if (!ready) {
        // Lay the graph out a few milliseconds at a time, so the page never freezes.
        const until = performance.now() + 8;
        while (performance.now() < until) {
          if (layout.step()) {
            build();
            break;
          }
        }
        return;
      }

      const box = stageEl!.getBoundingClientRect();
      if (box.bottom < 0 || box.top > innerHeight) return; // scrolled out of view
      const w = container!.clientWidth, h = container!.clientHeight;
      if (w === 0 || h === 0) return;
      if (w !== width || h !== height) {
        width = w;
        height = h;
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        pathMat.resolution.set(w, h);
        measure(); // the text's place follows the window's height even when its own size does not change
      }

      const range = box.height - innerHeight;
      const target = range > 0 ? clamp(-box.top / range) : 0;
      if (reduced) {
        // No fly-through: cross-fade between the two resting views instead.
        const wanted = target < 0.5 ? 0 : 1;
        if (wanted !== view) {
          veil -= dt / 0.15;
          if (veil <= 0) view = wanted;
        } else {
          veil = Math.min(1, veil + dt / 0.15);
        }
        formed = view;
      } else {
        scrolled.to(target, t);
        formed = smooth(clamp(scrolled.value(t)));
      }
      const e = formed;
      if (!usable() && hovered !== -1) hover(-1);
      if (e >= 0.5 !== wasFormed) {
        wasFormed = e >= 0.5;
        label();
      }

      // --- where the camera and the shape are ---
      // Two layouts, switching at the same width as the page's own (Tailwind's lg). Wide: only the
      // brain's top shows, rising from the bottom edge (see horizonY). Narrow: it sits behind the
      // text, centred and dimmed. Formed, the graph is centred, lower on a narrow screen to clear the heading.
      const aspect = width / height, wide = width >= 1024;
      // The distance at which the shape, 2 * RADIUS across, takes up these shares of the view's width and height.
      const distance = (ofWidth: number, ofHeight: number) => (RADIUS / slope) * Math.max(1 / (ofWidth * aspect), 1 / ofHeight);
      const away = wide ? horizonAway(aspect) : distance(1.05, 0.8);
      const close = wide ? distance(0.7, 0.92) : distance(0.96, 0.66);
      camera.position.z = mix(away, close, e);
      const textShare = textShareOf(height);
      outer.position.set(
        wide ? slope * aspect * mix(0, close * 0.1, e) : 0,
        mix(wide ? horizonY(away, height) : slope * -away * 0.08, slope * -close * (wide ? 0.04 : 0.16), e),
        0,
      );
      rest.x = outer.position.x;
      rest.y = outer.position.y;
      half.y = slope * camera.position.z;
      half.x = half.y * aspect;
      // Leaving the graph view puts the zoom back, so the brain always forms from the same place.
      if (!usable() && (zoom.target !== 1 || panX.target !== 0 || panY.target !== 0)) resetView();
      const zoomed = mix(1, zoom.value(t), e);
      outer.position.x += panX.value(t) * e;
      outer.position.y += panY.value(t) * e;
      outer.scale.set(zoomed, zoomed, zoomed * mix(1, 0.45, e));
      fog.near = camera.position.z - RADIUS * 0.3;
      fog.far = camera.position.z + RADIUS * 1.5;

      // The brain is seen from its side and sways; formed, the graph drifts round unless something is held.
      if (!reduced && !drag && hovered === -1 && zoom.target === 1) drift += dt * 0.025 * e;
      // The sway starts from rest when the scene is shown, which is the pose the loading screen draws.
      const sway = reduced || shownAt === Infinity ? 0 : Math.sin((t - shownAt) * 0.22) * 0.3;
      inner.rotation.set(0.1 + pitch, (-Math.PI / 2 + 0.4 + sway) * (1 - e) + drift + yaw, 0);
      outer.rotation.set(reduced ? 0 : leanX.value(t) * (1 - e), reduced ? 0 : leanY.value(t) * (1 - e), 0);

      if (shownAt === Infinity && !latest.current.held) {
        shownAt = t;
        begin(t, e);
      }
      // The entrance moves and sizes the finished picture, not the shape, so the brain keeps its
      // pose all the way: the camera looks at a larger window with the picture set inside it.
      const along = arrive.value(t), shrink = mix(enter.size, 1, along);
      if (Math.abs(1 - along) > 0.0005) {
        const cx = mix(enter.x, place.x, along), cy = mix(enter.y, place.y, along);
        camera.setViewOffset(width, height, place.x - cx / shrink, place.y - cy / shrink, width / shrink, height / shrink);
      } else if (camera.view?.enabled) {
        camera.clearViewOffset();
      }
      // 1 while the brain still stands on the loading screen's drawing, where nothing dims it yet.
      const fresh = enter.drawn ? 1 - clamp(along) : 0;

      // Real nodes travel from the brain to the graph, each setting off at its own moment; filler
      // neurons spread outwards as they fade.
      if (e !== drawn) {
        drawn = e;
        for (let i = 0; i < total; i++) {
          const go = i < n ? smooth(clamp(e * 1.4 - delay[i] * 0.4)) : 0;
          for (let axis = 0; axis < 3; axis++) {
            const k = i * 3 + axis;
            here[k] = i < n ? mix(home[k], graphAt[k], go) : home[k] * (1 + 0.3 * e);
          }
        }
        // Plain loops: this runs every frame of the scroll, and making small arrays here stutters.
        for (const [list, positions] of [[links, linkPositions], [mesh, meshPositions]] as const) {
          for (let k = 0; k < list.length; k++) {
            const a = list[k][0] * 3, b = list[k][1] * 3, o = k * 6;
            positions[o] = here[a]; positions[o + 1] = here[a + 1]; positions[o + 2] = here[a + 2];
            positions[o + 3] = here[b]; positions[o + 4] = here[b + 1]; positions[o + 5] = here[b + 2];
          }
        }
        dotGeometry.attributes.position.needsUpdate = true;
        linkGeometry.attributes.position.needsUpdate = true;
        meshGeometry.attributes.position.needsUpdate = true;
      }
      const solidity = smooth(clamp((e - 0.55) / 0.45)); // the solid shapes arrive in the second half
      const beside = hovered === -1 ? null : nodes[hovered].neighbours;
      // The shapes only need placing again when something about them changed.
      const pose = `${e}|${hovered}|${zoomed}`;
      const placeAgain = pose !== posed && solidity > 0;
      posed = pose;
      for (let i = 0; i < n && placeAgain; i++) {
        dummy.position.set(here[i * 3], here[i * 3 + 1], here[i * 3 + 2]);
        dummy.rotation.set(i, i * 2, 0); // so the cubes and diamonds do not all face the same way
        // Zooming in spreads the nodes apart faster than it enlarges them, which is what thins out a dense graph.
        dummy.scale.setScalar((size[i] * solidity * (i === hovered ? 1.8 : beside?.includes(i) ? 1.3 : 1)) / Math.sqrt(zoomed));
        dummy.updateMatrix();
        solids[meshOf[i]].setMatrixAt(slotOf[i], dummy.matrix);
      }
      for (const item of solids) {
        item.visible = solidity > 0;
        if (placeAgain) item.instanceMatrix.needsUpdate = true;
      }

      const meshShow = (1 - e) ** 2, linkShow = smooth(clamp((e - 0.3) / 0.7));
      meshLines.visible = meshShow > 0.002;
      linkLines.visible = linkShow > 0.002;
      meshMat.opacity = (dark ? 0.15 : 0.32) * meshShow * Math.min(1, shrink ** 0.8); // lines stay 1px wide, so a small picture needs fainter ones
      linkMat.opacity = (dark ? 0.28 : 0.45) * linkShow;

      // --- signals ---
      // A dot takes about half a second to warm and longer to cool: slow enough never to flash.
      const ease = reduced ? 1 : 1 - Math.exp(-dt * 2.2), cool = Math.exp(-dt * 1.1);
      for (let i = 0; i < total; i++) {
        energy[i] += (warmth[i] - energy[i]) * ease;
        warmth[i] *= cool;
        scale[i] = dotSize[i] * (i < n ? mix(1, 2.8, e) * (i === hovered ? 1.6 : 1) : 1);
        fade[i] = i < n ? 1 : meshShow;
      }
      const onGraph = e > 0.6;
      for (let k = 0; k < pulseCount; k++) {
        if ((pulseOnGraph[k] === 1) !== onGraph) launch(k, onGraph);
        pulsePhase[k] += dt * pulseSpeed[k];
        if (pulsePhase[k] >= 1) {
          warmth[pulseTo[k]] = 1; // the point it reaches warms up
          const next = onGraph ? nodes[pulseTo[k]]?.neighbours ?? [] : meshNext[pulseTo[k]];
          if (next.length === 0 || Math.random() < 0.3) {
            launch(k, onGraph);
          } else {
            pulseFrom[k] = pulseTo[k];
            pulseTo[k] = any(next);
            pulsePhase[k] = 0;
          }
        }
        const a = pulseFrom[k] * 3, b = pulseTo[k] * 3;
        for (let axis = 0; axis < 3; axis++) pulsePositions[k * 3 + axis] = mix(here[a + axis], here[b + axis], pulsePhase[k]);
        pulseFade[k] = Math.sin(Math.PI * pulsePhase[k]) * 0.6 * (onGraph ? linkShow : meshShow);
      }

      // --- the bright lines: the hero's traced path, or the hovered node's links ---
      let segments = 0;
      const brainShow = 1 - smooth(clamp(e / 0.25));
      const far = reduced ? path.length : reach.value(t);
      if (hovered !== -1) {
        links.forEach(([a, b], k) => {
          if (a === hovered || b === hovered) tracePositions.set(linkPositions.subarray(k * 6, k * 6 + 6), segments++ * 6);
        });
        traceMat.opacity = 0.7;
      }
      let strokes = 0;
      if (hovered === -1 && path.length > 1 && brainShow > 0) {
        for (let s = 0; s < Math.min(path.length - 1, 4); s++) {
          const part = clamp(far - s);
          if (part <= 0) break;
          const a = path[s] * 3, b = path[s + 1] * 3;
          for (let axis = 0; axis < 3; axis++) {
            pathArray[strokes * 6 + axis] = here[a + axis];
            pathArray[strokes * 6 + 3 + axis] = mix(here[a + axis], here[b + axis], part);
          }
          strokes++;
        }
        path.forEach((i, s) => {
          if (far < s - 0.05) return;
          warmth[i] = 1; // the nodes the light has reached stay warm, steadily
          scale[i] = dotSize[i] * 1.7;
        });
        pathMat.opacity = 0.9 * brainShow;
        (pathGeometry.attributes.instanceStart as InterleavedBufferAttribute).data.needsUpdate = true;
      }
      pathLines.visible = strokes > 0;
      pathGeometry.instanceCount = strokes;
      traceGeometry.setDrawRange(0, segments * 2);
      traceGeometry.attributes.position.needsUpdate = true;

      for (const name of ["scale", "energy", "fade"]) dotGeometry.attributes[name].needsUpdate = true;
      if (pulseCount) for (const name of ["position", "fade"]) pulseGeometry.attributes[name].needsUpdate = true;
      for (const material of [dotMat, pulseMat]) {
        material.uniforms.pixel.value = ((height * renderer.getPixelRatio()) / (2 * slope)) * shrink;
        material.uniforms.fogNear.value = fog.near;
        material.uniforms.fogFar.value = fog.far;
      }

      renderer.render(world, camera);
      if (!announced) {
        announced = true;
        latest.current.onReady();
      }
      // Behind the text the brain is dimmed: all of it on a narrow screen. On a wide one only what
      // reaches above the end of the text, which happens when the window is too short to clear it.
      const seen = (clamp((t - shownAt) / (enter.drawn ? 0.3 : 0.8)) * Math.max(0, veil) * (wide ? 1 : mix(mix(0.4, 1, fresh), 1, e))).toFixed(3);
      if (canvas!.style.opacity !== seen) canvas!.style.opacity = seen;
      const mask = wide && e < 0.999 ? `linear-gradient(to bottom, rgb(0 0 0 / ${mix(mix(0.25, 1, fresh), 1, e).toFixed(3)}) ${(textShare * 100 - 4).toFixed(1)}%, #000 ${(textShare * 100 + 5).toFixed(1)}%)` : "";
      if (canvas!.style.maskImage !== mask) canvas!.style.maskImage = mask;

      // No names on the small picture: they come in as the brain reaches its place.
      const settled = shownAt === Infinity ? 0 : smooth(clamp((along - 0.75) / 0.25));
      style(labelLayer!, "opacity", (Math.max(brainShow, smooth(clamp((e - 0.75) / 0.25))) * settled).toFixed(3));
      labels.forEach((el, k) => {
        const waiting = e < 0.5 && far < k - 0.05; // the light has not reached this node yet
        const p = labelled[k] === undefined || waiting ? null : onScreen(labelled[k]);
        const shown = p !== null && p.z < 1;
        if (el.classList.contains("hidden") === shown) el.classList.toggle("hidden", !shown);
        if (shown) style(el, "transform", `translate(${((p.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -170%)`);
      });
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      canvas.style.opacity = "0"; // a page kept alive in the background comes back with its last picture; hide it until the new scene draws
      scene.current = null;
      themeWatcher.disconnect();
      watching.disconnect();
      systemTheme.removeEventListener("change", applyTheme);
      stageEl.removeEventListener("pointermove", onPointerMove);
      stageEl.removeEventListener("pointerdown", onPointerDown);
      stageEl.removeEventListener("pointerleave", onLeave);
      stageEl.removeEventListener("click", onClick);
      stageEl.removeEventListener("wheel", onWheel);
      removeEventListener("pointerup", onPointerUp);
      controlsRef.current = null;
      stageEl.style.cursor = "";
      stageEl.style.userSelect = "";
      probe.remove();
      for (const el of labels) el.remove();
      for (const item of [...Object.values(shapes), dotGeometry, meshGeometry, linkGeometry, traceGeometry, pulseGeometry,
        dotMat, pulseMat, meshMat, linkMat, traceMat, pathGeometry, pathMat, solid]) item.dispose();
      for (const item of solids) item.dispose();
      renderer.dispose();
    };
  }, [graph, interactive, stage, controlsRef, sketch, above, featured]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block size-full opacity-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
