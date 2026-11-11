"use client";

// The landing page's 3D graph, drawn with three.js. One scene plays two parts: far off and
// turning beside the headline, then, as the page scrolls, flying in and settling into a graph
// that can be hovered and opened. Everything here runs outside React, once per frame.
import { useEffect, useRef, type RefObject } from "react";
import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DirectionalLight, Fog, Group, InstancedMesh, LineBasicMaterial, LineSegments, MeshLambertMaterial,
  NormalBlending, Object3D, OctahedronGeometry, PerspectiveCamera, Points, PointsMaterial, Scene,
  SphereGeometry, Vector3, WebGLRenderer,
} from "three";
import { createLayout, RADIUS, type Graph, type GraphNode, type Kind } from "@/lib/graph";

type Props = {
  graph: Graph;
  /** Whether nodes can be hovered and opened. Off for the placeholder shape. */
  interactive: boolean;
  /** The element whose scroll position drives the fly-in. It also receives the pointer events. */
  stage: RefObject<HTMLElement | null>;
  onOpen: (person: GraphNode) => void;
  onUnsupported: () => void;
};

const KINDS: Kind[] = ["person", "project", "skill"];
const FOV = 40;
const LABELS = 10;
const PULSES = 48;
const PICK_RADIUS = 16; // px around the pointer that counts as on a node
const LABEL_CLASS = "absolute left-0 top-0 hidden whitespace-nowrap rounded border bg-surface/85 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink";

const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** A soft round dot, used for the glow behind each node and for the pulses on the links. */
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.35, "rgba(255,255,255,0.35)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export function GraphCanvas({ graph, interactive, stage, onOpen, onUnsupported }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, so a new function from the parent does not rebuild the scene.
  const handlers = useRef({ onOpen, onUnsupported });
  useEffect(() => {
    handlers.current = { onOpen, onUnsupported };
  });

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current, labelLayer = labelsRef.current, stageEl = stage.current;
    if (!container || !canvas || !labelLayer || !stageEl) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      handlers.current.onUnsupported();
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { nodes, links } = graph;
    const n = nodes.length, m = links.length;

    // --- scene -----------------------------------------------------------------------------
    const scene = new Scene();
    const fog = new Fog(0x000000, 1, 100);
    scene.fog = fog;
    const camera = new PerspectiveCamera(FOV, 1, 0.1, 400);
    scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.4);
    sun.position.set(0.4, 1, 0.8);
    scene.add(sun);
    // `outer` places the graph and flattens it towards the viewer; `inner` turns and grows it.
    const outer = new Group(), inner = new Group();
    outer.add(inner);
    scene.add(outer);

    const shapes = { person: new SphereGeometry(0.2, 16, 12), project: new OctahedronGeometry(0.46), skill: new BoxGeometry(0.36, 0.36, 0.36) };
    const meshOf: number[] = [], slotOf: number[] = [];
    const counts = [0, 0, 0];
    for (const node of nodes) {
      const k = KINDS.indexOf(node.kind);
      meshOf.push(k);
      slotOf.push(counts[k]++);
    }
    const solid = new MeshLambertMaterial({ flatShading: true }); // each node's colour is set per instance
    const meshes = KINDS.map((kind, k) => {
      const mesh = new InstancedMesh(shapes[kind], solid, counts[k]);
      mesh.frustumCulled = false;
      inner.add(mesh);
      return mesh;
    });
    // Busier projects and skills are drawn larger.
    const size = nodes.map((node) => (node.kind === "person" ? 1 : 1 + Math.min(node.neighbours.length, 12) * 0.05));

    const glow = glowTexture();
    const haloGeometry = new BufferGeometry(), linkGeometry = new BufferGeometry(), traceGeometry = new BufferGeometry(), pulseGeometry = new BufferGeometry();
    const haloColors = new Float32Array(n * 3), linkColors = new Float32Array(m * 6);
    const linkPositions = new Float32Array(m * 6), tracePositions = new Float32Array(m * 6);
    const pulseCount = reduced ? 0 : Math.min(PULSES, m);
    const pulsePositions = new Float32Array(pulseCount * 3);
    const pulseLink = Array.from({ length: pulseCount }, () => Math.floor(Math.random() * m));
    const pulsePhase = Array.from({ length: pulseCount }, () => Math.random());
    const pulseSpeed = Array.from({ length: pulseCount }, () => 0.25 + Math.random() * 0.35);

    const haloMaterial = new PointsMaterial({ size: 3.2, map: glow, vertexColors: true, transparent: true, depthWrite: false });
    const linkMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const traceMaterial = new LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    const pulseMaterial = new PointsMaterial({ size: 0.7, map: glow, transparent: true, depthWrite: false });
    const halos = new Points(haloGeometry, haloMaterial), lines = new LineSegments(linkGeometry, linkMaterial);
    const trace = new LineSegments(traceGeometry, traceMaterial), pulses = new Points(pulseGeometry, pulseMaterial);
    for (const object of [lines, trace, halos, pulses]) {
      object.frustumCulled = false;
      object.visible = false; // until the layout is ready
      inner.add(object);
    }
    for (const mesh of meshes) mesh.visible = false;

    // --- colours follow the page theme -----------------------------------------------------
    const probe = document.createElement("span");
    probe.hidden = true;
    container.append(probe);
    const token = (name: string) => {
      probe.style.color = `var(${name})`;
      return new Color(getComputedStyle(probe).color);
    };
    const palette = { person: new Color(), project: new Color(), skill: new Color() };
    const background = new Color();

    // --- layout, then the buffers that depend on it ----------------------------------------
    const layout = createLayout(graph);
    const at = layout.positions;
    const dummy = new Object3D(), colour = new Color(), point = new Vector3();
    let ready = false, builtAt = 0;
    let hovered = -1;

    function place(i: number, scale: number) {
      dummy.position.set(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]);
      dummy.rotation.set(i, i * 2, 0); // so the cubes and diamonds do not all face the same way
      dummy.scale.setScalar(size[i] * scale);
      dummy.updateMatrix();
      meshes[meshOf[i]].setMatrixAt(slotOf[i], dummy.matrix);
    }

    /** Colours and sizes for the current hover: the hovered node and its neighbours stay lit. */
    function paint() {
      const lit = hovered === -1 ? null : new Set([hovered, ...nodes[hovered].neighbours]);
      for (let i = 0; i < n; i++) {
        colour.copy(palette[nodes[i].kind]);
        if (lit && !lit.has(i)) colour.lerp(background, 0.85);
        meshes[meshOf[i]].setColorAt(slotOf[i], colour);
        colour.toArray(haloColors, i * 3);
        place(i, i === hovered ? 1.8 : lit?.has(i) ? 1.3 : 1);
      }
      let traced = 0;
      links.forEach(([a, b], k) => {
        for (const [end, offset] of [[a, 0], [b, 3]]) {
          colour.copy(palette[nodes[end].kind]);
          if (lit) colour.lerp(background, 0.75);
          colour.toArray(linkColors, k * 6 + offset);
        }
        if (a === hovered || b === hovered) tracePositions.set(linkPositions.subarray(k * 6, k * 6 + 6), traced++ * 6);
      });
      traceGeometry.setDrawRange(0, traced * 2);
      traceGeometry.attributes.position.needsUpdate = true;
      haloGeometry.attributes.color.needsUpdate = true;
      linkGeometry.attributes.color.needsUpdate = true;
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }

    function applyTheme() {
      background.copy(token("--color-bg"));
      for (const kind of KINDS) palette[kind].copy(token(`--color-${kind}`));
      const dark = background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
      fog.color.copy(background);
      // Light adds up on a dark page and would wash out on a light one.
      for (const material of [haloMaterial, linkMaterial, pulseMaterial]) {
        material.blending = dark ? AdditiveBlending : NormalBlending;
        material.needsUpdate = true;
      }
      haloMaterial.opacity = dark ? 0.42 : 0.14;
      linkMaterial.opacity = dark ? 0.38 : 0.5;
      pulseMaterial.color.copy(dark ? token("--color-ink") : palette.person);
      traceMaterial.color.copy(token("--color-ink"));
      if (ready) paint();
    }

    function build() {
      links.forEach(([a, b], k) => {
        linkPositions.set(at.subarray(a * 3, a * 3 + 3), k * 6);
        linkPositions.set(at.subarray(b * 3, b * 3 + 3), k * 6 + 3);
      });
      haloGeometry.setAttribute("position", new BufferAttribute(at, 3));
      haloGeometry.setAttribute("color", new BufferAttribute(haloColors, 3));
      linkGeometry.setAttribute("position", new BufferAttribute(linkPositions, 3));
      linkGeometry.setAttribute("color", new BufferAttribute(linkColors, 3));
      traceGeometry.setAttribute("position", new BufferAttribute(tracePositions, 3));
      pulseGeometry.setAttribute("position", new BufferAttribute(pulsePositions, 3));
      for (const object of [...meshes, lines, trace, halos, pulses]) object.visible = true;
      ready = true;
      builtAt = performance.now();
      applyTheme();
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

    /** Which nodes carry a label: the hovered one and its neighbours, else the busiest projects. */
    function label() {
      labelled = !interactive ? []
        : hovered !== -1 ? [hovered, ...nodes[hovered].neighbours].slice(0, LABELS)
        : busiest.slice(0, container!.clientWidth < 640 ? 3 : 6);
      labels.forEach((el, k) => {
        const node = nodes[labelled[k]];
        el.className = `${LABEL_CLASS} ${labelled[k] === hovered ? "z-10 border-accent" : "border-line"}`;
        el.textContent = node ? (labelled[k] === hovered ? `${node.name} · ${node.kind}` : node.name) : "";
      });
    }

    const project = (i: number) => point.set(at[i * 3], at[i * 3 + 1], at[i * 3 + 2]).applyMatrix4(inner.matrixWorld).project(camera);
    let width = 0, height = 0;

    /** The node under a point on the canvas, or -1. Works on screen positions, so small nodes are easy to hit. */
    function pick(x: number, y: number) {
      let best = -1, nearest = PICK_RADIUS * PICK_RADIUS;
      for (let i = 0; i < n; i++) {
        const p = project(i);
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
    let settled = 0; // 0 in the hero, 1 once the graph has flown in; follows the scroll
    let pointerX = 0, pointerY = 0, yaw = 0, pitch = 0;
    let drag: { x: number; y: number; moved: number } | null = null;
    const usable = () => interactive && ready && settled > 0.85;
    const onControl = (event: Event) => event.target instanceof Element && event.target.closest("a, button, summary, details") !== null;
    const onCanvas = (event: MouseEvent) => {
      const box = canvas.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top] as const;
    };

    function hover(i: number) {
      if (i === hovered) return;
      hovered = i;
      stageEl!.style.cursor = i !== -1 && nodes[i].kind === "person" ? "pointer" : "";
      paint();
      label();
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / innerWidth) * 2 - 1;
      pointerY = (event.clientY / innerHeight) * 2 - 1;
      if (drag) {
        yaw += (event.clientX - drag.x) * 0.006;
        pitch = clamp(pitch + (event.clientY - drag.y) * 0.006, -1, 1);
        drag.moved += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      }
      hover(usable() && !onControl(event) ? pick(...onCanvas(event)) : -1);
    };
    const onPointerDown = (event: PointerEvent) => {
      // Dragging turns the graph. Mouse only: on a touch screen the same gesture scrolls the page.
      if (!usable() || event.pointerType !== "mouse" || event.button !== 0 || onControl(event)) return;
      drag = { x: event.clientX, y: event.clientY, moved: 0 };
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
      if (i !== -1 && nodes[i].kind === "person") handlers.current.onOpen(nodes[i]);
    };
    const onLeave = () => hover(-1);
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
    let frame = 0, last = performance.now();
    let spin = 0, tiltX = 0, tiltY = 0, fade = 1;

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

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
      }

      // How far the page has scrolled from the hero (0) to the graph view (1).
      const range = box.height - innerHeight;
      const target = range > 0 ? clamp(-box.top / range, 0, 1) : 0;
      if (reduced) {
        // No fly-through: cross-fade between the two resting views instead.
        const view = target < 0.5 ? 0 : 1;
        if (view !== settled) {
          fade -= dt / 0.15;
          if (fade <= 0) settled = view;
        } else {
          fade = Math.min(1, fade + dt / 0.15);
        }
      } else {
        settled += (target - settled) * (1 - Math.exp(-dt * 5));
      }
      const e = smooth(clamp(settled, 0, 1));
      if (!usable() && hovered !== -1) hover(-1);

      const aspect = width / height, wide = aspect > 1.1;
      const slope = Math.tan((FOV / 2) * (Math.PI / 180));
      const fit = RADIUS / (slope * Math.min(1, aspect)); // the distance at which the graph fills the short side
      const away = fit * (wide ? 1.22 : 1.3), close = fit * 1.12;
      camera.position.z = mix(away, close, e);
      // In the hero the graph sits beside the headline (or under it on a narrow screen). Settled,
      // it leaves the left of a wide screen to the text.
      outer.position.set(
        (wide ? slope * aspect : 0) * mix(away * 0.46, close * 0.14, e),
        slope * mix(wide ? 0 : -away * 0.5, -close * 0.06, e),
        0,
      );
      outer.scale.z = mix(1, 0.45, e);
      fog.near = camera.position.z - RADIUS * 0.4;
      fog.far = camera.position.z + RADIUS * 1.7;

      const grow = reduced ? 1 : 1 - Math.pow(1 - Math.min(1, (now - builtAt) / 1400), 3);
      inner.scale.setScalar(mix(0.25, 1, grow));
      if (!reduced) {
        // Turns steadily in the hero, slows to a drift once settled, and holds still under the pointer.
        if (!drag && hovered === -1) spin += dt * mix(0.12, 0.02, e);
        tiltX += (pointerY * 0.1 * (1 - e) - tiltX) * (1 - Math.exp(-dt * 4));
        tiltY += (pointerX * 0.14 * (1 - e) - tiltY) * (1 - Math.exp(-dt * 4));
      }
      inner.rotation.set(mix(0.3, 0.12, e) + pitch, spin + yaw, 0);
      outer.rotation.set(tiltX, tiltY, 0);

      for (let k = 0; k < pulseCount; k++) {
        pulsePhase[k] += dt * pulseSpeed[k];
        if (pulsePhase[k] > 1) {
          pulsePhase[k] = 0;
          pulseLink[k] = Math.floor(Math.random() * m);
        }
        const from = pulseLink[k] * 6;
        for (let axis = 0; axis < 3; axis++) {
          pulsePositions[k * 3 + axis] = mix(linkPositions[from + axis], linkPositions[from + 3 + axis], pulsePhase[k]);
        }
      }
      if (pulseCount) pulseGeometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
      canvas!.style.opacity = String(Math.min(1, (now - builtAt) / 600) * Math.max(0, fade));

      labelLayer!.style.opacity = String(smooth(clamp((settled - 0.75) / 0.25, 0, 1)));
      labels.forEach((el, k) => {
        const p = labelled[k] === undefined ? null : project(labelled[k]);
        const shown = p !== null && p.z < 1;
        el.classList.toggle("hidden", !shown);
        if (shown) el.style.transform = `translate(${(p.x * 0.5 + 0.5) * width}px, ${(-p.y * 0.5 + 0.5) * height}px) translate(-50%, -170%)`;
      });
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      themeWatcher.disconnect();
      systemTheme.removeEventListener("change", applyTheme);
      stageEl.removeEventListener("pointermove", onPointerMove);
      stageEl.removeEventListener("pointerdown", onPointerDown);
      stageEl.removeEventListener("pointerleave", onLeave);
      stageEl.removeEventListener("click", onClick);
      removeEventListener("pointerup", onPointerUp);
      stageEl.style.cursor = "";
      stageEl.style.userSelect = "";
      probe.remove();
      for (const el of labels) el.remove();
      for (const item of [...Object.values(shapes), haloGeometry, linkGeometry, traceGeometry, pulseGeometry,
        haloMaterial, linkMaterial, traceMaterial, pulseMaterial, solid, glow]) item.dispose();
      for (const mesh of meshes) mesh.dispose();
      renderer.dispose();
    };
  }, [graph, interactive, stage]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block size-full opacity-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
