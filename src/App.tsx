import { USAGE_LIMITS, usageLimitMessage } from "./limits";
import { FLASH } from "./model";
import { drawPreviewFrame } from "./geometry";
import {
  newMetrics,
  recordMeasurement,
  median,
  formatLatency,
  formatCost,
  formatUsd,
  latestLabel,
  type Measurement,
} from "./metrics";
import { useEffect, useRef, useState } from "react";
import {
  Aperture,
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Circle,
  Minus,
  Coffee,
  SwitchCamera,
  Hand,
  Layers3,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  ThumbsUp,
  Trash2,
  X,
  Download,
} from "lucide-react";
import {
  presets,
  MAX_RULES,
  MAX_AGE,
  CaptureGate,
  acceptedFrame,
  type Rule,
  type Match,
  type Category,
} from "./rules";
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  let I;
  switch (name) {
    case "thumb":
      I = ThumbsUp;
      break;
    case "mug":
      I = Coffee;
      break;
    case "book":
      I = BookOpen;
      break;
    case "hand":
    case "peace":
      I = Hand;
      break;
    case "counter":
    case "wood":
      I = Layers3;
      break;
    default:
      I = Aperture;
  }
  return <I size={size} strokeWidth={1.8} />;
}
const words: Record<Match, string> = {
  matched: "Matched",
  unmet: "Not yet",
  checking: "Checking",
  uncertain: "Uncertain",
};
type Observation = {
  at: number;
  states: Record<string, Match>;
  complete: boolean;
  changed: string[];
};
type Frame = {
  original: string;
  image: string;
  signature: Uint8ClampedArray;
  at: number;
};
export default function App() {
  const stage = useRef<HTMLDivElement>(null),
    decoderHost = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLCanvasElement>(null),
    stopPreview = useRef<(() => void) | null>(null),
    previewFrame = useRef<{ at: number; geometry: string } | null>(null),
    lastCheckFailure = useRef<{ status?: number; code: string } | null>(null),
    mirrored = useRef(false),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    cameraGeneration = useRef(0),
    visibilityEpoch = useRef(0),
    version = useRef(0),
    busy = useRef(false),
    gate = useRef(new CaptureGate()),
    observationRef = useRef<Observation | null>(null),
    armRef = useRef(false),
    runningRef = useRef(false),
    checkingIntent = useRef(false),
    rulesRef = useRef<Rule[]>([]),
    lastSignature = useRef<Uint8ClampedArray | null>(null),
    lastSent = useRef(0),
    count = useRef(0),
    session = useRef(crypto.randomUUID());
  const [rules, setRules] = useState<Rule[]>([]),
    [observation, setObservation] = useState<Observation | null>(null),
    [checking, setChecking] = useState(false),
    [checkFailed, setCheckFailed] = useState(false),
    [ready, setReady] = useState(false),
    [starting, setStarting] = useState(false),
    [cameraNotice, setCameraNotice] = useState(""),
    [diagnostics, setDiagnostics] = useState<string | null>(null),
    [running, setRunning] = useState(false),
    [facing, setFacing] = useState<"environment" | "user">("environment"),
    [message, setMessage] = useState("Your scene. Your conditions."),
    [cameraError, setCameraError] = useState(""),
    [armed, setArmed] = useState(false),
    [capture, setCapture] = useState<{
      image: string;
      automatic: boolean;
    } | null>(null),
    [metrics, setMetrics] = useState(newMetrics),
    [checks, setChecks] = useState(0),
    [sheet, setSheet] = useState<"add" | "edit" | "info" | "metrics" | null>(
      null,
    ),
    [category, setCategory] = useState<Category | "All">("All"),
    [editing, setEditing] = useState<Rule | null>(null),
    [custom, setCustom] = useState(""),
    [textEditing, setTextEditing] = useState(false),
    [conflict, setConflict] = useState<Rule | null>(null),
    [replaceId, setReplaceId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    backdropStart = useRef(false),
    addButton = useRef<HTMLButtonElement>(null),
    pickerScroll = useRef<HTMLDivElement>(null),
    metricsButton = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    newRuleDraft = useRef(""),
    editFromPicker = useRef(false),
    revealCustom = useRef<string | null>(null),
    editDrafts = useRef(new Map<string, string>());
  const enabled = rules.filter((r) => r.enabled),
    states = observation?.states ?? {},
    matched = enabled.filter((r) => states[r.id] === "matched").length,
    allMatched =
      running &&
      !!observation?.complete &&
      enabled.length > 0 &&
      matched === enabled.length;
  function resultTitle() {
    if (!enabled.length) return "Choose your rules";
    if (checkFailed) return "Couldn’t check this sample";
    if (!running) return "Checking paused";
    if (!observation)
      return checking ? "Checking the scene…" : "Waiting for a fresh result";
    if (!observation.complete) return "Incomplete check";
    if (allMatched) {
      if (armed) return "First match — checking again";
      return enabled.length === 1
        ? "Rule matched"
        : `All ${enabled.length} rules matched`;
    }
    return `${matched} of ${enabled.length} matched`;
  }
  function resultContext() {
    if (!enabled.length) return "The camera stays live";
    if (!running) return "Tap Live to resume";
    if (!observation)
      return checking
        ? "A new sample is being checked"
        : "No fresh observation";
    const label = observation.complete ? "Last check" : "Incomplete check";
    return `${label}${checking ? " · checking a new sample…" : " · sampled frame"}`;
  }
  function ruleStateLabel(rule: Rule) {
    if (!rule.enabled) return "Disabled";
    if (!running) return "Paused";
    if (checkFailed) return "Check failed";
    if (!observation) return "Checking";
    return words[states[rule.id] || "uncertain"];
  }
  function clearObservation() {
    observationRef.current = null;
    setObservation(null);
  }
  useEffect(() => {
    if (!observation) return;
    const timeout = setTimeout(
      () => {
        clearObservation();
        gate.current.reset();
        setMessage("Waiting for a fresh result.");
      },
      Math.max(0, observation.at + MAX_AGE - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [observation]);
  function invalidate() {
    version.current++;
    gate.current.reset();
    clearObservation();
    setChecking(false);
    setCheckFailed(false);
    lastSignature.current = null;
    armRef.current = false;
    setArmed(false);
  }
  function updateRules(next: Rule[]) {
    invalidate();
    rulesRef.current = next;
    setRules(next);
    if (!next.some((r) => r.enabled)) {
      runningRef.current = false;
      setRunning(false);
      setMessage("Add a rule to start checking.");
    } else if (ready && checkingIntent.current && !document.hidden) {
      runningRef.current = true;
      setRunning(true);
      setMessage("Rules updated. Checking your scene.");
    } else setMessage("Rules updated. Tap play when you’re ready.");
  }
  function pause() {
    checkingIntent.current = false;
    runningRef.current = false;
    setRunning(false);
    invalidate();
    setMessage("Live checking paused.");
  }
  function resume() {
    if (
      !rulesRef.current.some((r) => r.enabled) ||
      document.hidden ||
      !stream.current
    ) {
      runningRef.current = false;
      setRunning(false);
      setMessage("Add a rule to start checking.");
      return;
    }
    checkingIntent.current = true;
    invalidate();
    runningRef.current = true;
    setRunning(true);
    setMessage("Looking for your rules…");
  }
  function beginPreview(element: HTMLVideoElement, generation: number) {
    stopPreview.current?.();
    let stopped = false,
      callback = 0,
      lastDraw = -Infinity,
      lastMediaTime = -1;
    const videoFrames = typeof element.requestVideoFrameCallback === "function";
    const draw = (now: number) => {
      if (stopped || generation !== cameraGeneration.current) return;
      const region = stage.current,
        canvas = preview.current;
      const geometry = `${region?.clientWidth}:${region?.clientHeight}:${element.videoWidth}:${element.videoHeight}:${mirrored.current}`;
      const geometryChanged = previewFrame.current?.geometry !== geometry;
      if (
        !document.hidden &&
        region &&
        canvas &&
        now - lastDraw >= 30 &&
        (videoFrames ||
          element.currentTime !== lastMediaTime ||
          geometryChanged)
      ) {
        if (previewFrame.current && geometryChanged) invalidate();
        try {
          if (
            drawPreviewFrame(
              element,
              canvas,
              region.clientWidth,
              region.clientHeight,
              mirrored.current,
            )
          ) {
            previewFrame.current = { at: Date.now(), geometry };
            lastDraw = now;
            lastMediaTime = element.currentTime;
          }
        } catch {
          previewFrame.current = null;
        }
      }
      callback = videoFrames
        ? element.requestVideoFrameCallback(draw)
        : requestAnimationFrame(draw);
    };
    stopPreview.current = () => {
      stopped = true;
      if (videoFrames) element.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
    };
    draw(performance.now());
  }
  async function startCamera(next = facing) {
    const wantsChecking = stream.current ? checkingIntent.current : true;
    const startVisibility = visibilityEpoch.current;
    const generation = ++cameraGeneration.current;
    pause();
    setReady(false);
    setStarting(true);
    setCameraError("");
    stopPreview.current?.();
    previewFrame.current = null;
    video.current?.pause();
    if (video.current) video.current.srcObject = null;
    decoderHost.current?.replaceChildren();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera requires a secure browser connection.");
      const result = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: next },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (generation !== cameraGeneration.current) {
        result.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = result;
      const element = document.createElement("video");
      element.playsInline = true;
      element.muted = true;
      element.autoplay = true;
      element.setAttribute("playsinline", "");
      element.setAttribute("aria-hidden", "true");
      decoderHost.current?.replaceChildren(element);
      video.current = element;
      element.srcObject = result;
      await element.play();
      if (generation !== cameraGeneration.current) return;
      const actualFacing = result.getVideoTracks()[0]?.getSettings().facingMode;
      const selectedFacing =
        actualFacing === "user" || actualFacing === "environment"
          ? actualFacing
          : next;
      mirrored.current = selectedFacing === "user";
      setFacing(selectedFacing);
      beginPreview(element, generation);
      setCameraNotice(
        selectedFacing === "user" ? "Front camera · mirrored" : "Rear camera",
      );
      setStarting(false);
      setReady(true);
      if (
        !document.hidden &&
        wantsChecking &&
        startVisibility === visibilityEpoch.current
      ) {
        checkingIntent.current = true;
        resume();
      }
      result.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (generation === cameraGeneration.current) {
          pause();
          setReady(false);
          setCameraError("Camera disconnected. Reconnect and try again.");
        }
      });
    } catch (error) {
      if (generation !== cameraGeneration.current) return;
      setStarting(false);
      setCameraError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera access is off. Allow camera access in your browser settings, then try again."
          : "Could not start the camera. Close other camera apps and try again.",
      );
    }
  }
  function takeFrame(): Frame | null {
    const full = preview.current,
      displayed = previewFrame.current;
    if (!full || !displayed || Date.now() - displayed.at > MAX_AGE) return null;
    const small = document.createElement("canvas");
    small.width = Math.round(
      full.width * Math.min(1, 640 / Math.max(full.width, full.height)),
    );
    small.height = Math.round(
      full.height * Math.min(1, 640 / Math.max(full.width, full.height)),
    );
    small.getContext("2d")!.drawImage(full, 0, 0, small.width, small.height);
    const sig = document.createElement("canvas");
    sig.width = 24;
    sig.height = 24;
    const ctx = sig.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(small, 0, 0, 24, 24);
    return {
      original: full.toDataURL("image/jpeg", 0.94),
      image: small.toDataURL("image/jpeg", 0.75),
      signature: ctx.getImageData(0, 0, 24, 24).data,
      at: displayed.at,
    };
  }
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!runningRef.current || busy.current || document.hidden) return;
      const active = rulesRef.current.filter((r) => r.enabled);
      if (!active.length) return;
      const frame = takeFrame();
      if (!frame) return;
      const previous = lastSignature.current;
      let difference = 255;
      if (previous) {
        let sum = 0;
        for (let i = 0; i < previous.length; i += 4)
          sum += Math.abs(previous[i] - frame.signature[i]);
        difference = sum / (previous.length / 4);
      }
      if (
        previous &&
        difference < 7 &&
        !armRef.current &&
        Date.now() - lastSent.current < 3500
      )
        return;
      busy.current = true;
      setChecking(true);
      const requestVersion = version.current;
      lastSent.current = Date.now();
      lastSignature.current = frame.signature;
      count.current++;

      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 12000);
      let measurement: Measurement = {
        outcome: "error",
        roundTripMs: 0,
        live: false,
      };
      const requestStarted = performance.now();
      lastCheckFailure.current = null;
      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            image: frame.image,
            rules: active.map(({ id, text }) => ({
              id,
              text,
            })),
            version: requestVersion,
            session: session.current,
          }),
        });
        if (!response.ok) {
          if (requestVersion !== version.current) return;
          const failure = (await response.json().catch(() => null)) as {
            code?: unknown;
          } | null;
          if (requestVersion !== version.current) return;
          lastCheckFailure.current = {
            status: response.status,
            code:
              typeof failure?.code === "string" &&
              /^[a-z0-9_]{1,40}$/.test(failure.code)
                ? failure.code
                : `http_${response.status}`,
          };
          if (
            response.status === 429 ||
            response.status === 403 ||
            response.status === 401
          ) {
            checkingIntent.current = false;
            runningRef.current = false;
            setRunning(false);
            armRef.current = false;
            setArmed(false);
          }
          throw new Error(
            response.status === 429
              ? usageLimitMessage(lastCheckFailure.current.code)
              : response.status === 401 || response.status === 403
                ? "Your private session needs a refresh. Sign in again."
                : "Could not check this frame. Retrying…",
          );
        }
        if (
          response.redirected ||
          !response.headers.get("content-type")?.includes("application/json")
        ) {
          if (requestVersion !== version.current) return;
          lastCheckFailure.current = {
            status: response.status,
            code: "session_or_non_json",
          };
          checkingIntent.current = false;
          runningRef.current = false;
          setRunning(false);
          armRef.current = false;
          setArmed(false);
          throw new Error(
            "Your private session needs a refresh. Sign in again.",
          );
        }
        const result = (await response.json()) as {
          version: number;
          states: Record<string, Match>;
          elapsedMs: number;
          measurementSource?: string;
          model?: unknown;
          complete?: boolean;
          usage?: { inputTokens?: unknown };
        };
        const roundTripMs = performance.now() - requestStarted;
        const complete =
          result.complete === true &&
          active.every((r) =>
            ["matched", "unmet", "uncertain"].includes(result.states?.[r.id]),
          );
        measurement = {
          outcome: complete ? "success" : "partial",
          roundTripMs,
          inputTokens: result.usage?.inputTokens,
          model: result.model,
          live:
            import.meta.env.PROD && result.measurementSource === "workers-ai",
        };
        if (
          !acceptedFrame(
            requestVersion,
            version.current,
            frame.at,
            Date.now(),
            document.hidden,
          ) ||
          result.version !== requestVersion
        ) {
          measurement.outcome = "stale";
          return;
        }
        const clean = Object.fromEntries(
          active.map((r) => [
            r.id,
            ["matched", "unmet", "uncertain"].includes(result.states?.[r.id])
              ? result.states[r.id]
              : "uncertain",
          ]),
        );
        const previousObservation = observationRef.current;
        const changed = active.filter(
          (r) => previousObservation?.states[r.id] !== clean[r.id],
        );
        const nextObservation = {
          at: frame.at,
          states: clean,
          complete,
          changed: changed.map((r) => r.id),
        };
        observationRef.current = nextObservation;
        setObservation(nextObservation);
        setCheckFailed(false);

        const stable = gate.current.accept(
          complete ? Object.values(clean) : [],
          Date.now(),
        );
        const wholeSceneMatched =
          complete && Object.values(clean).every((s) => s === "matched");
        let feedback = "";
        if (!complete) feedback = "This check was incomplete. Checking again…";
        else if (wholeSceneMatched)
          feedback = armRef.current
            ? "First match — checking again."
            : "All rules matched in the last check.";
        else if (changed.length) {
          feedback = changed
            .slice(0, 2)
            .map((r) => `${r.label}: ${words[clean[r.id]]}`)
            .join(" · ");
          if (changed.length > 2)
            feedback += ` · ${changed.length - 2} more changed`;
        }
        setMessage(feedback);
        if (armRef.current && stable) {
          armRef.current = false;
          setArmed(false);
          setCapture({ image: frame.original, automatic: true });
          pause();
          setMessage("Captured the exact matched frame.");
        }
      } catch (error) {
        if (requestVersion === version.current) {
          lastCheckFailure.current ??= {
            code:
              error instanceof Error && error.name === "AbortError"
                ? "timeout"
                : "network_or_response_error",
          };
          gate.current.reset();
          clearObservation();
          setCheckFailed(true);
          setMessage(
            error instanceof Error && error.name === "AbortError"
              ? "This check took too long. Retrying…"
              : lastCheckFailure.current.code === "session_or_non_json" ||
                  lastCheckFailure.current.status === 401 ||
                  lastCheckFailure.current.status === 403
                ? "Your private session needs a refresh. Sign in again."
                : lastCheckFailure.current.status === 429
                  ? usageLimitMessage(lastCheckFailure.current.code)
                  : "Could not check this frame. See Details for diagnostics.",
          );
        }
      } finally {
        if (measurement.outcome === "error")
          measurement.roundTripMs = performance.now() - requestStarted;
        setMetrics((previous) => recordMeasurement(previous, measurement));
        setChecks(count.current);
        clearTimeout(timeout);
        busy.current = false;
        setChecking(false);
      }
    }, 1500);
    const visibility = () => {
      if (document.hidden) {
        visibilityEpoch.current++;
        pause();
        setMessage("Paused while you were away. Tap play to resume.");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    const region = stage.current;
    if (!region) return;
    let size = `${region.clientWidth}:${region.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${region.clientWidth}:${region.clientHeight}`;
      if (next !== size) {
        invalidate();
        previewFrame.current = null;
        size = next;
      }
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!cameraNotice) return;
    const timer = setTimeout(() => setCameraNotice(""), 2400);
    return () => clearTimeout(timer);
  }, [cameraNotice]);
  useEffect(() => {
    const resize = () => {
      const vv = window.visualViewport;
      document.documentElement.style.setProperty(
        "--visual-height",
        `${vv?.height || innerHeight}px`,
      );
      document.documentElement.dataset.keyboard = String(
        !!vv && innerHeight - vv.height > 120,
      );
      document.documentElement.dataset.compactEditor = String(
        (vv?.height || innerHeight) < 320,
      );
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${Math.max(0, innerHeight - (vv?.height || innerHeight) - (vv?.offsetTop || 0))}px`,
      );
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(
    () => () => {
      cameraGeneration.current++;
      stopPreview.current?.();
      video.current?.pause();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    document.documentElement.classList.toggle("sheet-open", !!sheet);
    return () => document.documentElement.classList.remove("sheet-open");
  }, [sheet]);
  useEffect(() => {
    if (sheet && !dialog.current?.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else if (!sheet) dialog.current?.close();
  }, [sheet]);
  useEffect(() => {
    if (conflict && pickerScroll.current) pickerScroll.current.scrollTop = 0;
  }, [conflict]);
  useEffect(() => {
    if (sheet === "add" && !textEditing && revealCustom.current) {
      document
        .getElementById(`picker-custom-${revealCustom.current}`)
        ?.scrollIntoView({ block: "nearest" });
      revealCustom.current = null;
    }
  }, [rules, sheet, textEditing]);
  function closeSheet() {
    leaveTextEditor();
    setSheet(null);
    setConflict(null);
    setReplaceId(null);
  }
  function openPicker() {
    setCustom(newRuleDraft.current);
    setTextEditing(false);
    setSheet("add");
  }
  function finishEdit() {
    if (editFromPicker.current) {
      leaveTextEditor();
      revealCustom.current = editing?.id ?? null;
      openPicker();
    } else closeSheet();
  }
  function changeDraft(value: string) {
    setCustom(value);
    if (sheet === "edit" && editing) editDrafts.current.set(editing.id, value);
    else newRuleDraft.current = value;
  }
  function leaveTextEditor() {
    (document.activeElement as HTMLElement)?.blur();
    setTextEditing(false);
  }
  function keyboardDone(
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }
  function choose(rule: Rule, force = false, keepBoth = false) {
    if (rules.some((r) => r.id === rule.id) && !replaceId) {
      updateRules(rules.filter((r) => r.id !== rule.id));
      return;
    }
    if (
      rule.category === "Gestures" &&
      !force &&
      !keepBoth &&
      !replaceId &&
      rules.some((r) => r.category === "Gestures" && r.enabled)
    ) {
      setConflict(rule);
      return;
    }
    let next = force ? rules.filter((r) => r.category !== "Gestures") : rules;
    if (replaceId) next = next.filter((r) => r.id !== replaceId);
    if (next.length >= MAX_RULES) {
      setMessage("Keep it focused: up to six rules.");
      return;
    }
    updateRules([
      ...next.filter((r) => r.id !== rule.id),
      { ...rule, enabled: true },
    ]);
    setConflict(null);
    setReplaceId(null);
  }
  function addCustom() {
    const value = custom.trim();
    if (!value) return;
    if (editing && sheet === "edit") {
      editDrafts.current.delete(editing.id);
      updateRules(
        rules.map((r) =>
          r.id === editing.id
            ? {
                ...r,
                label: value,
                text: value,
                category: "Custom",
                icon: "custom",
              }
            : r,
        ),
      );
      finishEdit();
      return;
    }
    const id = crypto.randomUUID();
    revealCustom.current = id;
    choose({
      id,
      label: value,
      text: value,
      category: "Custom",
      icon: "custom",
      enabled: true,
    });
    newRuleDraft.current = "";
    setCustom("");
    leaveTextEditor();
  }
  function openEdit(rule: Rule, fromPicker = false) {
    editFromPicker.current = fromPicker;
    setEditing(rule);
    setCustom(editDrafts.current.get(rule.id) ?? rule.text);
    setTextEditing(false);
    setSheet("edit");
  }
  function manual() {
    const f = takeFrame();
    if (f) {
      setCapture({ image: f.original, automatic: false });
      pause();
      setMessage("Manual capture. Saved only on this device.");
    }
  }
  function toggleArm() {
    if (armRef.current) {
      armRef.current = false;
      setArmed(false);
      gate.current.reset();
      return;
    }
    resume();
    gate.current.reset();
    armRef.current = true;
    setArmed(true);
    setMessage("Auto armed. Waiting for two fresh matching checks.");
  }
  return (
    <main className="app">
      <section
        className={`viewfinder ${allMatched ? "all-matched" : ""} ${ready ? "camera-active" : "camera-off"} ${facing === "user" ? "front" : ""}`}
        aria-label="Camera viewfinder"
      >
        <div className="camera-stage" ref={stage}>
          <div
            className="camera-decoder"
            ref={decoderHost}
            aria-hidden="true"
          />
          <canvas
            className="camera-preview"
            ref={preview}
            aria-label="Live camera preview"
          />
        </div>
        <div className="camera-shade" />
        <header>
          <a className="brand" href="/" aria-label="ClefCam home">
            <img src="/icon.svg" width="27" height="27" alt="" />
            <span>
              ClefCam<span className="brand-dot">.</span>
            </span>
          </a>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="About ClefCam"
              onClick={() => setSheet("info")}
            >
              <CircleHelp size={20} />
            </button>
            {ready && (
              <button
                className="icon-button"
                aria-label="Switch camera"
                title="Switch front / rear camera"
                disabled={!ready}
                onClick={() =>
                  startCamera(facing === "environment" ? "user" : "environment")
                }
              >
                <SwitchCamera size={22} />
              </button>
            )}
          </div>
        </header>
        {ready && cameraNotice && (
          <div className="camera-notice" role="status">
            {cameraNotice}
          </div>
        )}
        {!ready && (
          <div className="welcome">
            <div className="welcome-content">
              <h1>
                {cameraError ? (
                  "Camera unavailable"
                ) : starting ? (
                  "Opening your camera…"
                ) : (
                  <>
                    A camera that
                    <br />
                    follows your rules.
                  </>
                )}
              </h1>
              {!cameraError && !starting && (
                <p className="welcome-value">
                  Powered by Cloudflare Clef.
                  <br />
                  Stack visual rules. See them match live.
                </p>
              )}
              {cameraError && (
                <p className="camera-error" role="alert">
                  {cameraError}
                </p>
              )}
              <button
                className="primary"
                disabled={starting}
                onClick={() => startCamera()}
              >
                <Camera size={19} />
                {starting
                  ? "Opening camera…"
                  : cameraError
                    ? "Try camera again"
                    : "Open camera"}
              </button>
              <p className="privacy">
                Snapshots are sent to Cloudflare
                <br className="wide-break" /> to check your rules.
              </p>
              <button
                className="welcome-secondary"
                onClick={() => {
                  setCategory("All");
                  openPicker();
                }}
              >
                {rules.length
                  ? `Edit ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`
                  : "Choose rules first"}
              </button>
              {metrics.completed > 0 && (
                <button
                  className="welcome-secondary"
                  aria-label="Cost and speed details"
                  onClick={() => setSheet("metrics")}
                >
                  View session cost & speed
                </button>
              )}
            </div>
          </div>
        )}
        {ready && (
          <div className="bottom">
            <div className="scene-status">
              <button
                className={`live ${running ? "is-live" : ""}`}
                disabled={!enabled.length}
                onClick={running ? pause : resume}
              >
                {running ? <span className="live-dot" /> : <Play size={11} />}{" "}
                {running ? "Live" : "Paused"}
              </button>
              <div className="result-summary">
                <strong>{resultTitle()}</strong>
                <span>{resultContext()}</span>
              </div>
              <button
                className="add-rule"
                ref={addButton}
                onClick={() => {
                  setCategory("All");
                  openPicker();
                }}
              >
                <Plus size={16} />
                <span>Add rule</span>
              </button>
              {ready && (
                <button
                  className="quiet small"
                  aria-label={
                    running ? "Pause live checking" : "Resume live checking"
                  }
                  disabled={!enabled.length}
                  onClick={running ? pause : resume}
                >
                  {running ? <Pause size={17} /> : <Play size={17} />}
                </button>
              )}
            </div>
            <div className="rule-stack" aria-label="Active rules">
              {rules.map((r) => (
                <button
                  key={r.id}
                  className={`chip ${r.enabled ? states[r.id] || "checking" : "disabled"}`}
                  onClick={() => openEdit(r)}
                >
                  <span className="rule-name">
                    <Icon name={r.icon} size={16} />
                    <span>{r.label}</span>
                  </span>
                  <span
                    className={`rule-outcome ${observation?.changed.includes(r.id) ? "just-changed" : ""}`}
                    key={`${r.id}-${states[r.id] ?? "waiting"}`}
                  >
                    {!r.enabled ? (
                      <Minus size={15} />
                    ) : states[r.id] === "matched" ? (
                      <Check size={15} />
                    ) : states[r.id] === "uncertain" ? (
                      <CircleHelp size={15} />
                    ) : states[r.id] === "unmet" ? (
                      <Minus size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    <span className="state-label">{ruleStateLabel(r)}</span>
                  </span>
                </button>
              ))}
            </div>
            {metrics.completed > 0 && (
              <button
                className="metrics-strip"
                ref={metricsButton}
                aria-label="Cost and speed details"
                aria-haspopup="dialog"
                aria-expanded={sheet === "metrics"}
                onClick={() => setSheet("metrics")}
              >
                <span className="metrics-model">
                  {metrics.latest?.model ? FLASH.label : "Model unavailable"}
                </span>
                <span className="metrics-latency">{latestLabel(metrics)}</span>
                <span className="metrics-cost">
                  {metrics.latest?.inputTokens != null
                    ? `~${formatCost(metrics.latest.inputTokens, metrics.latest.model)}/check`
                    : metrics.latest
                      ? "Cost unavailable"
                      : "—/check"}
                </span>
                <ChevronRight size={12} />
              </button>
            )}
            <div className="capture-rail">
              <button
                className={`auto-button ${armed ? "armed" : ""}`}
                disabled={!ready || !enabled.length}
                onClick={toggleArm}
              >
                <Sparkles size={21} />
                <span>{armed ? "Disarm" : "Auto"}</span>
              </button>
              <button
                className="shutter"
                aria-label="Take manual photo"
                disabled={!ready}
                onClick={manual}
              >
                <span />
              </button>
              <button className="info-button" onClick={() => setSheet("info")}>
                <Settings2 size={20} />
                <span>Details</span>
              </button>
            </div>
            <p className="hint" aria-live="polite">
              {enabled.length ? message : ""}
            </p>
          </div>
        )}
      </section>
      <aside className="desktop-caption">
        <span>A camera that follows your rules</span>
        <span>Powered by Cloudflare Clef</span>
      </aside>
      <dialog
        ref={dialog}
        className={`sheet ${sheet === "add" ? "picker-sheet" : ""} ${textEditing ? "text-editing" : ""}`}
        aria-labelledby="sheet-title"
        onCancel={closeSheet}
        onPointerDownCapture={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          backdropStart.current =
            e.target === e.currentTarget &&
            (e.clientX < box.left ||
              e.clientX > box.right ||
              e.clientY < box.top ||
              e.clientY > box.bottom);
        }}
        onPointerCancel={() => {
          backdropStart.current = false;
        }}
        onClick={(e) => {
          // Focus can resize the sheet between touch down and synthesized click.
          // Only a gesture that started on the backdrop may dismiss it.
          const outside = backdropStart.current;
          backdropStart.current = false;
          const box = e.currentTarget.getBoundingClientRect();
          if (
            outside &&
            e.target === e.currentTarget &&
            (e.clientX < box.left ||
              e.clientX > box.right ||
              e.clientY < box.top ||
              e.clientY > box.bottom)
          )
            closeSheet();
        }}
        onClose={() => {
          setSheet(null);
          (returnFocus.current || addButton.current)?.focus();
        }}
      >
        <div className="sheet-body">
          <div className="sheet-handle" />
          <div className="sheet-heading">
            {(textEditing || (sheet === "edit" && editFromPicker.current)) && (
              <button
                className="close-button editor-back"
                aria-label={
                  textEditing ? "Back to rules" : "Back to rule picker"
                }
                onClick={textEditing ? leaveTextEditor : finishEdit}
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div>
              <h2 id="sheet-title">
                {textEditing
                  ? sheet === "edit"
                    ? "Edit rule"
                    : "Write a rule"
                  : sheet === "add"
                    ? replaceId
                      ? "Replace a rule"
                      : "Set the scene"
                    : sheet === "edit"
                      ? "Fine-tune your rule"
                      : sheet === "metrics"
                        ? "Cost & speed"
                        : "Behind the camera"}
              </h2>
              <p>
                {sheet === "add"
                  ? "Pick a few. They work together."
                  : sheet === "edit"
                    ? "Every enabled rule needs to match."
                    : sheet === "metrics"
                      ? "One check. Your whole rule stack."
                      : "A small camera experiment with Clef."}
              </p>
            </div>
            <button
              className="close-button"
              aria-label={
                sheet === "metrics"
                  ? "Close cost and speed details"
                  : "Close rules"
              }
              onClick={closeSheet}
            >
              <X size={21} />
            </button>
          </div>
          {sheet === "add" && (
            <>
              <div className="categories" aria-label="Rule categories">
                {(
                  [
                    "All",
                    "Gestures",
                    "Objects",
                    "Background",
                    "Surfaces",
                    "Custom",
                  ] as const
                ).map((c) => (
                  <button
                    key={c}
                    className={category === c ? "selected" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="sheet-scroll" ref={pickerScroll}>
                {conflict && (
                  <div className="conflict">
                    <strong>One hand, one gesture?</strong>
                    <p>
                      Replacing your other gesture makes this easier to film.
                    </p>
                    <button
                      className="primary"
                      onClick={() => choose(conflict, true)}
                    >
                      Replace gesture
                    </button>
                    <button
                      className="text-button"
                      onClick={() => choose(conflict, false, true)}
                    >
                      Keep both gestures
                    </button>
                  </div>
                )}
                {rules.some((r) => r.category === "Custom") && (
                  <section
                    className="custom-rules"
                    aria-labelledby="custom-rules-title"
                  >
                    <h3 id="custom-rules-title">Your custom rules</h3>
                    {rules
                      .filter((r) => r.category === "Custom")
                      .map((r) => (
                        <div
                          className="custom-rule-row"
                          id={`picker-custom-${r.id}`}
                          key={r.id}
                        >
                          <button
                            className="custom-rule-edit"
                            aria-label={`Edit custom rule: ${r.label}`}
                            onClick={() => openEdit(r, true)}
                          >
                            <span className="preset-copy">
                              <strong>{r.label}</strong>
                              <small>
                                {r.enabled ? "Enabled" : "Disabled"} · Tap to
                                edit
                              </small>
                            </span>
                            <ChevronRight size={18} />
                          </button>
                          <button
                            className="custom-rule-remove"
                            aria-label={`Remove custom rule: ${r.label}`}
                            onClick={() => {
                              editDrafts.current.delete(r.id);
                              updateRules(rules.filter((x) => x.id !== r.id));
                            }}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))}
                  </section>
                )}
                {(category === "All" || category === "Custom") && (
                  <form
                    className="custom-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <label htmlFor="custom-rule">Make it your own</label>
                    <div>
                      <textarea
                        rows={2}
                        id="custom-rule"
                        maxLength={180}
                        value={custom}
                        onChange={(e) => changeDraft(e.target.value)}
                        onFocus={() => setTextEditing(true)}
                        onKeyDown={keyboardDone}
                        enterKeyHint="done"
                        placeholder="A red mug on a wooden table"
                      />
                      <button
                        type="button"
                        onClick={addCustom}
                        aria-label="Add custom rule"
                        disabled={!custom.trim() || rules.length >= MAX_RULES}
                      >
                        <Plus size={20} />
                        {textEditing && <span>Add rule</span>}
                      </button>
                    </div>
                    <p>
                      Describe one visible condition. Keep details about the
                      same object in one rule.
                    </p>
                  </form>
                )}
                <div className="preset-list">
                  {presets
                    .filter(
                      (r) => category === "All" || r.category === category,
                    )
                    .map((r) => {
                      const selected = rules.some((x) => x.id === r.id);
                      return (
                        <button
                          className={`preset ${selected ? "chosen" : ""}`}
                          key={r.id}
                          aria-pressed={selected}
                          disabled={
                            !selected && rules.length >= MAX_RULES && !replaceId
                          }
                          onClick={() => choose(r)}
                        >
                          <span className={`preset-icon ${r.icon}`}>
                            <Icon name={r.icon} />
                          </span>
                          <span className="preset-copy">
                            <strong>{r.label}</strong>
                            <small>{r.category}</small>
                          </span>
                          <span className="selection">
                            {selected ? (
                              <Check size={18} />
                            ) : (
                              <Plus size={18} />
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
              <footer className="sheet-footer">
                <span>
                  {rules.length} of {MAX_RULES} rules selected
                </span>
                <button className="primary" onClick={closeSheet}>
                  Done
                  <Check size={18} />
                </button>
              </footer>
            </>
          )}
          {sheet === "edit" && editing && (
            <div className="sheet-scroll edit-content">
              <label htmlFor="edit-rule">Visible condition</label>
              <textarea
                id="edit-rule"
                maxLength={180}
                rows={3}
                value={custom}
                onChange={(e) => changeDraft(e.target.value)}
                onFocus={() => setTextEditing(true)}
                onKeyDown={keyboardDone}
                enterKeyHint="done"
              />
              <button
                className="primary full"
                disabled={!custom.trim()}
                onClick={addCustom}
              >
                Save rule
              </button>
              <button
                className="action-row"
                onClick={() => {
                  updateRules(
                    rules.map((r) =>
                      r.id === editing.id ? { ...r, enabled: !r.enabled } : r,
                    ),
                  );
                  finishEdit();
                }}
              >
                <Pause size={19} />
                {editing.enabled ? "Disable rule" : "Enable rule"}
                <ChevronRight size={18} />
              </button>
              <button
                className="action-row"
                onClick={() => {
                  setReplaceId(editing.id);
                  setCustom("");
                  setCategory("All");
                  openPicker();
                }}
              >
                <RefreshCw size={19} />
                Replace rule
                <ChevronRight size={18} />
              </button>
              <button
                className="action-row danger"
                onClick={() => {
                  updateRules(rules.filter((r) => r.id !== editing.id));
                  editDrafts.current.delete(editing.id);
                  finishEdit();
                }}
              >
                <Trash2 size={19} />
                Remove rule
              </button>
            </div>
          )}
          {sheet === "metrics" && (
            <div className="sheet-scroll info-content metrics-details">
              <div className="metrics-summary">
                <span>Latest check</span>
                <strong>{latestLabel(metrics)}</strong>
                <small>
                  {metrics.latest?.live && metrics.latest.outcome === "success"
                    ? "Round trip"
                    : metrics.latest
                      ? "No current successful measurement"
                      : "Waiting for your first check"}
                </small>
              </div>
              <dl>
                <div>
                  <dt>Latest response model</dt>
                  <dd>{metrics.latest?.model ? FLASH.label : "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Latest input rate</dt>
                  <dd>
                    {metrics.latest?.model
                      ? `$${FLASH.rate.toFixed(2)}/M tokens`
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Estimated cost / check</dt>
                  <dd>
                    {metrics.latest
                      ? formatCost(
                          metrics.latest.inputTokens,
                          metrics.latest.model,
                        )
                      : "No check yet"}
                  </dd>
                </div>
                <div>
                  <dt>Typical round trip</dt>
                  <dd>{formatLatency(median(metrics.successfulLatencies))}</dd>
                </div>
                <div>
                  <dt>Successful live checks</dt>
                  <dd>{metrics.successful}</dd>
                </div>
                <div>
                  <dt>Completed attempts</dt>
                  <dd>{metrics.completed} checks</dd>
                </div>
                <div>
                  <dt>Session inference estimate</dt>
                  <dd>
                    {!metrics.completed
                      ? "No checks yet"
                      : !metrics.knownUsageChecks
                        ? "Unavailable"
                        : `${formatUsd(metrics.estimatedUsd)}${metrics.unknownUsageChecks ? " + unknown" : ""}`}
                  </dd>
                </div>
              </dl>
              {metrics.unknownUsageChecks > 0 && (
                <p className="metrics-note">
                  Usage unavailable for {metrics.unknownUsageChecks}{" "}
                  {metrics.unknownUsageChecks === 1 ? "attempt" : "attempts"}.
                  The session total is incomplete; missing usage is never
                  counted as free.
                </p>
              )}
              {metrics.latest &&
                !metrics.latest.live &&
                metrics.latest.outcome !== "error" && (
                  <p className="metrics-note">
                    Test data is excluded from live speed and spend totals.
                  </p>
                )}
              <p>
                Round trip is measured in this browser, from sending a request
                to receiving and reading its result, including the network.
                Typical is the median of {metrics.successfulLatencies.length}{" "}
                successful, fresh live checks this session. Failed, stale and
                incomplete results are excluded.
              </p>
              <p>
                Estimates use returned input tokens at Clef Flash’s $0.09/M
                input rate, including usage from stale replies. Each check
                evaluates the enabled stack. This is a list-price estimate, not
                your invoice; free allowances, neuron accounting and
                infrastructure charges can differ.
              </p>
              <p>
                This session starts when this page loads and ends on reload or
                close. Pausing, changing rules or switching cameras does not
                reset it. Server budget reservations are separate conservative
                limits, not measured spend.
              </p>
              {lastCheckFailure.current?.status === 429 && (
                <p role="status">
                  {usageLimitMessage(lastCheckFailure.current.code)}
                </p>
              )}
              <a
                className="pricing-link"
                href="https://developers.cloudflare.com/workers-ai/models/clef-flash/"
                target="_blank"
                rel="noreferrer"
              >
                Published Flash pricing
              </a>
              <button className="primary full" onClick={closeSheet}>
                Back to camera
              </button>
            </div>
          )}
          {sheet === "info" && (
            <div className="sheet-scroll info-content">
              <p>
                Clef checks small, sampled still frames against all your enabled
                rules in one request. This is live feedback, not a saved video.
              </p>
              <dl>
                <div>
                  <dt>Model</dt>
                  <dd>{FLASH.label}</dd>
                </div>
                <div>
                  <dt>Checks this session</dt>
                  <dd>{checks}</dd>
                </div>
              </dl>
              <p>
                Frames are sent to Cloudflare for inference. ClefCam does not
                store or log your camera images on its server. Manual photos and
                Auto captures stay in this browser until you download them.
              </p>
              <p>
                Auto takes one photo after two fresh matching checks, then
                pauses. Rule changes, camera switches and leaving this tab
                disarm it.
              </p>
              <p>
                Live checks pause in the background. There is no per-page check
                limit. Shared reservations allow{" "}
                {USAGE_LIMITS.daily.toLocaleString("en-US")} units per UTC day
                and {USAGE_LIMITS.lifetime.toLocaleString("en-US")} over the
                lifetime of this demo. Reloading does not reset them. A still
                scene is checked less often. Results can be uncertain; this is a
                visual demo, not a safety system.
              </p>
              {lastCheckFailure.current?.status === 429 && (
                <p role="status">
                  {usageLimitMessage(lastCheckFailure.current.code)}
                </p>
              )}
              <a
                className="pricing-link"
                href="https://developers.cloudflare.com/workers-ai/models/clef-flash/"
                target="_blank"
                rel="noreferrer"
              >
                Published Flash pricing
              </a>
              <button className="primary full" onClick={closeSheet}>
                Back to camera
              </button>
              <button
                className="text-button"
                onClick={() => {
                  const v = video.current,
                    c = preview.current,
                    r = stage.current,
                    settings = stream.current
                      ?.getVideoTracks()[0]
                      ?.getSettings();
                  setDiagnostics(
                    JSON.stringify(
                      {
                        build: "matching-feedback-2026-10-04",
                        renderer: "canvas",
                        facing: settings?.facingMode || facing,
                        source: [v?.videoWidth, v?.videoHeight],
                        stage: [r?.clientWidth, r?.clientHeight],
                        canvas: [c?.width, c?.height],
                        readyState: v?.readyState,
                        paused: v?.paused,
                        frameAgeMs: previewFrame.current
                          ? Date.now() - previewFrame.current.at
                          : null,
                        lastCheckFailure: lastCheckFailure.current,
                      },
                      null,
                      2,
                    ),
                  );
                }}
              >
                Show diagnostics
              </button>
              {diagnostics && <pre className="diagnostics">{diagnostics}</pre>}
              <p className="build-label">Build: matching-feedback-2026-10-04</p>
            </div>
          )}
        </div>
      </dialog>
      {capture && (
        <div
          className="capture-review"
          role="dialog"
          aria-modal="true"
          aria-label="Captured photo"
        >
          <img
            src={capture.image}
            alt={
              capture.automatic
                ? "The evaluated matching frame"
                : "Your manually captured frame"
            }
          />
          <div>
            <h2>
              {capture.automatic ? "Captured matching frame" : "Photo captured"}
            </h2>
            <p>
              {capture.automatic
                ? "Two fresh checks matched. Auto is now off."
                : "Manual photo. Rules were not required."}
              <br />
              Only on this device until you download.
            </p>
            <a
              className="primary"
              href={capture.image}
              download={`clefcam-${Date.now()}.jpg`}
            >
              <Download size={19} />
              Download photo
            </a>
            <button
              className="text-button"
              onClick={() => {
                setCapture(null);
                resume();
              }}
            >
              <ArrowLeft size={17} />
              Back to live
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
