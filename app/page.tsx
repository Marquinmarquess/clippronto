"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ImageSegmenter as MediaPipeImageSegmenter } from "@mediapipe/tasks-vision";

type Product = {
  name: string;
  label: string;
  file?: File;
  url?: string;
};

type TextStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  background: string;
  shadow: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  align: "left" | "center" | "right";
  letterSpacing: number;
  positionY: number;
};

type TextTarget = "title" | "category" | "labels" | "extra";
type BackgroundRemovalMode = "white" | "smart";
type TemplateMode = "ranking" | "timed-ranking" | "free" | "cinematic" | "routine" | "react" | "question-box";
type RankingRevealMode = "sequential" | "all";
type RankingPosition = "left" | "right" | "bottom";
type RankingMotionId = "slide" | "rise" | "zoom" | "bounce" | "spin";
type RankingSettings = {
  count: number;
  revealMode: RankingRevealMode;
  position: RankingPosition;
  motion: RankingMotionId;
  motionDuration: number;
  itemTimes: number[];
  itemEndTimes: number[];
  itemLayers: number[];
  displayMode: "together" | "numbers-first";
  numberLeadTime: number;
  numberSpacing: number;
  itemScales: number[];
};
type ExtraTextLayer = { id: string; text: string; style: TextStyle };
type RoutineHeadings = { day: string; night: string };
type RankingScene = { id: string; title: string; category: string; duration: number };
type QuestionBoxContent = {
  prompt: string;
  answer: string;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
};
type TimelineSelection =
  | { kind: "main"; index: number }
  | { kind: "factory"; index: number }
  | { kind: "ranking"; index: number }
  | { kind: "broll"; id: string }
  | { kind: "audio" }
  | { kind: "imported-audio"; id: string }
  | { kind: "scene"; index: number }
  | { kind: "removed"; index: number };
type ContextTarget = TimelineSelection | { kind: "watermark" };
type ImportedAudioTrack = { id: string; name: string; file: File; url: string; samples: number[]; duration: number; volume: number; offset: number };
// Full content snapshot of one scene (a template + its own media). Global effects
// (watermark, imported audios) are NOT part of a scene — they span the project.
type SceneData = {
  mode: TemplateMode;
  settings: EditorSettings;
  products: Product[];
  canvasLayouts: CanvasLayouts;
  rankingSettings: RankingSettings;
  rankingScenes: RankingScene[];
  selectedRankingScene: number;
  routineHeadings: RoutineHeadings;
  questionBox: QuestionBoxContent;
  extraTextLayers: ExtraTextLayer[];
  rankingScaleTarget: number;
  videoFile?: File;
  videoUrl?: string;
  videoDuration: number;
  silentRanges: SilentRange[];
  videoSplits: number[];
  mainSegmentOrder: number[];
  mainCrop: MainCrop;
  mainVideoFocus: VideoFocus;
  playbackSpeed: number;
  audioExtracted: boolean;
  brollClips: BrollClip[];
  timelineMarkers: TimelineMarker[];
  reactMediaFile?: File;
  reactMediaUrl?: string;
  reactMediaType: "video" | "image";
  reactLayout: ReactOverlayLayout;
  reactRemoveBackground: boolean;
  reactMaskThreshold: number;
  reactEdgeSoftness: number;
  photoReelFile?: File;
  photoReelUrl?: string;
  photoReelDuration: number;
  cinematicLayout: CinematicLayout;
  splitDirection: SplitDirection;
  splitPosition: number;
  splitBarSize: number;
  splitBarColor: string;
  brollPlacement: "first" | "second";
};
type Scene = { id: string; name: string; data: SceneData };
type ExportPreset = { name: string; note: string; width: number; height: number; fps: number; bitrate: number };
// Shared render target so several scenes can be recorded into one video file.
type SuperClip = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  compositionCanvas: HTMLCanvasElement;
  compositionContext: CanvasRenderingContext2D;
  recorder: MediaRecorder;
  audioContext: AudioContext;
  audioDestination: MediaStreamAudioDestinationNode;
  preset: ExportPreset;
  sceneLabel: string;
};

const TEMPLATE_LABELS: Record<TemplateMode, string> = {
  ranking: "Ranking",
  "timed-ranking": "Ranking animado",
  free: "Livre",
  cinematic: "Cinema",
  routine: "Rotina",
  react: "React",
  "question-box": "Caixinha",
};
type CanvasElementId = "title" | "category" | "question-box" | "watermark" | `label-${number}` | `product-${number}` | `extra-text-${string}`;
type WatermarkFormat = "full" | "compact";
type CanvasElementLayout = { x: number; y: number; width: number; rotation?: number };
type CanvasLayouts = Record<CanvasElementId, CanvasElementLayout>;

type EditorSettings = {
  title: string;
  category: string;
  accent: string;
  removeAudio: boolean;
  removeSilence: boolean;
  thresholdDb: number;
  minimumSilence: number;
  padding: number;
  textStyles: Record<TextTarget, TextStyle>;
  products: Array<Pick<Product, "name" | "label">>;
};

type StoredProduct = Pick<Product, "name" | "label"> & { image?: Blob };

type SavedTemplate = Omit<EditorSettings, "products"> & {
  products: StoredProduct[];
  id: string;
  savedAt: number;
  mode?: TemplateMode;
  layouts?: CanvasLayouts;
  ranking?: RankingSettings;
  rankingScenes?: RankingScene[];
  extraTexts?: ExtraTextLayer[];
  routineHeadings?: RoutineHeadings;
  questionBox?: QuestionBoxContent;
};

type SilentRange = { start: number; end: number; origin?: "automatic" | "manual" };
type TranscriptChunk = { text: string; timestamp: [number, number | null] };
type SoundEffectId = "whoosh" | "impact" | "riser" | "pop" | "shutter" | "sparkle";
type CinematicLayout = "replace" | "split-bar" | "split-gradient";
type SplitDirection = "horizontal" | "vertical";
type VideoFocus = { x: number; y: number };
type BrollClip = {
  id: string;
  name: string;
  file: File;
  url: string;
  sourceUrl?: string;
  sourceStart: number;
  sourceDuration: number;
  duration: number;
  timelineStart: number;
  sfx: SoundEffectId;
  focusX: number;
  focusY: number;
  layer: number;
  placement?: "sequence" | "overlay";
  overlayX?: number;
  overlayY?: number;
  overlayWidth?: number;
};
type ExportPresetId = "hd" | "full-hd" | "2k" | "4k";
type FactorySection = "hook" | "body" | "cta";
type FactoryStyle = "standard" | "cinematic" | "split";
type FactoryHookFormat = "standard" | "react" | "split" | "question";
type FactoryClip = {
  id: string;
  section: FactorySection;
  file: File;
  url: string;
  name: string;
  duration: number;
  silentRanges: SilentRange[];
  removedSeconds: number;
  averageRms: number;
  status: "analyzing" | "ready" | "error";
  sourceStart?: number;
  sourceEnd?: number;
  sourceText?: string;
  hookFormat?: FactoryHookFormat;
  availableSilentRanges?: SilentRange[];
  sourceLimitStart?: number;
  sourceLimitEnd?: number;
};
type FactoryVariant = {
  id: string;
  hook: FactoryClip;
  body: FactoryClip;
  cta: FactoryClip;
  duration: number;
};
type FactoryProjectStatus = "adjusting" | "edited" | "downloaded";
type FactoryProject = {
  id: string;
  variantId: string;
  name: string;
  status: FactoryProjectStatus;
  clips?: [FactoryClip, FactoryClip, FactoryClip];
};
type FactoryRemovedRange = { at: number; duration: number; section: FactorySection; sourceStart: number; sourceEnd: number };
type FactoryStructureRange = { section: FactorySection; start: number; end: number };
type FactoryInputMode = "banks" | "single";
type ReactOverlayLayout = { x: number; y: number; width: number; height: number; radius: number };
type MainCrop = { zoom: number; x: number; y: number };
type TimelineMarker = { id: string; time: number; label: string; color: string };
type EditorSnapshot = {
  silentRanges: SilentRange[];
  videoSplits: number[];
  mainSegmentOrder: number[];
  mainCrop: MainCrop;
  playbackSpeed: number;
  audioExtracted: boolean;
  removeAudio: boolean;
  brollClips: BrollClip[];
  markers: TimelineMarker[];
};

const EXPORT_PRESETS: Record<ExportPresetId, { name: string; note: string; width: number; height: number; fps: number; bitrate: number }> = {
  hd: { name: "HD rápido", note: "Arquivo leve e exportação mais estável", width: 720, height: 1280, fps: 30, bitrate: 5_000_000 },
  "full-hd": { name: "Full HD", note: "Recomendado para Instagram e TikTok", width: 1080, height: 1920, fps: 30, bitrate: 10_000_000 },
  "2k": { name: "2K", note: "Mais definição para textos e produtos", width: 1440, height: 2560, fps: 30, bitrate: 18_000_000 },
  "4k": { name: "4K", note: "Qualidade máxima, exige mais do computador", width: 2160, height: 3840, fps: 30, bitrate: 35_000_000 },
};

const SOUND_EFFECTS: Array<{ id: SoundEffectId; name: string; note: string }> = [
  { id: "whoosh", name: "Whoosh suave", note: "Entrada cinematográfica" },
  { id: "impact", name: "Impacto grave", note: "Revelação importante" },
  { id: "riser", name: "Riser curto", note: "Cria expectativa" },
  { id: "pop", name: "Pop limpo", note: "Produto ou texto" },
  { id: "shutter", name: "Corte seco", note: "Transição rápida" },
  { id: "sparkle", name: "Brilho premium", note: "Beleza e acabamento" },
];

const FACTORY_SECTIONS: Array<{ id: FactorySection; order: number; name: string; description: string; color: string }> = [
  { id: "hook", order: 1, name: "Hook", description: "Abertura que prende atenção", color: "#ffb84d" },
  { id: "body", order: 2, name: "Corpo", description: "Desenvolvimento e entrega", color: "#6d58f3" },
  { id: "cta", order: 3, name: "CTA", description: "Chamada para a ação", color: "#3ebd7b" },
];

const FACTORY_HOOK_FORMATS: Array<{ id: FactoryHookFormat; name: string; icon: string; note: string }> = [
  { id: "standard", name: "Padrão", icon: "▶", note: "Tela cheia" },
  { id: "react", name: "React", icon: "◉", note: "Apresentador sobre o apoio" },
  { id: "split", name: "Dividida", icon: "◫", note: "Duas telas" },
  { id: "question", name: "Pergunta", icon: "?", note: "Caixinha editável" },
];

const RANKING_MOTIONS: Array<{ id: RankingMotionId; name: string; icon: string; note: string }> = [
  { id: "slide", name: "Deslizar", icon: "→", note: "Entrada lateral suave" },
  { id: "rise", name: "Subir", icon: "↑", note: "Chega de baixo" },
  { id: "zoom", name: "Zoom", icon: "◎", note: "Aproxima até a posição" },
  { id: "bounce", name: "Elástico", icon: "↝", note: "Encaixe com leve impulso" },
  { id: "spin", name: "Girar", icon: "↻", note: "Rotação curta e limpa" },
];

const DEFAULT_RANKING_TIMES = [1, 2.5, 4, 5.5, 7, 8.5, 10, 11.5, 13, 14.5];
const DEFAULT_RANKING_SETTINGS: RankingSettings = {
  count: 5,
  revealMode: "sequential",
  position: "left",
  motion: "slide",
  motionDuration: .65,
  itemTimes: DEFAULT_RANKING_TIMES,
  itemEndTimes: Array(10).fill(9_999),
  itemLayers: Array.from({ length: 10 }, (_, index) => index),
  displayMode: "together",
  numberLeadTime: .65,
  numberSpacing: 2,
  itemScales: Array(10).fill(1),
};

const DATABASE_NAME = "clippronto-local";
const TEMPLATE_STORE = "templates";

const SAFE_ZONES = {
  instagram: { name: "Instagram Reels", top: 10, right: 13, bottom: 20, left: 6 },
  tiktok: { name: "TikTok", top: 8, right: 16, bottom: 23, left: 6 },
} as const;

const FONT_OPTIONS = [
  { name: "Clássica", family: "Montserrat Local", note: "Similar ao Classic" },
  { name: "Moderna", family: "Bebas Neue Local", note: "Similar ao Modern" },
  { name: "Forte", family: "Anton Local", note: "Títulos de impacto" },
  { name: "Neon", family: "Pacifico Local", note: "Similar ao Neon" },
  { name: "Máquina", family: "Courier Prime Local", note: "Similar ao Typewriter" },
  { name: "Quadrinhos", family: "Comic Neue Local", note: "Similar ao Comic" },
  { name: "Editorial", family: "Playfair Display Local", note: "Serifada elegante" },
  { name: "Literatura", family: "Lora Local", note: "Texto editorial" },
  { name: "Assinatura", family: "Caveat Local", note: "Manuscrita" },
  { name: "Compacta", family: "Oswald Local", note: "Vertical e forte" },
  { name: "Impacto", family: "Archivo Black Local", note: "Peso máximo" },
  { name: "Elegante", family: "DM Serif Display Local", note: "Display clássica" },
] as const;

const DEFAULT_TEXT_STYLES: Record<TextTarget, TextStyle> = {
  title: { fontFamily: "Montserrat Local", fontSize: 94, fontWeight: 900, color: "#ffffff", strokeColor: "#080808", strokeWidth: 15, background: "transparent", shadow: true, italic: false, underline: false, uppercase: false, align: "center", letterSpacing: -2, positionY: 14 },
  category: { fontFamily: "Montserrat Local", fontSize: 78, fontWeight: 900, color: "#ffffff", strokeColor: "#080808", strokeWidth: 13, background: "transparent", shadow: true, italic: false, underline: false, uppercase: false, align: "center", letterSpacing: -1, positionY: 76 },
  labels: { fontFamily: "Montserrat Local", fontSize: 54, fontWeight: 900, color: "#ffffff", strokeColor: "#080808", strokeWidth: 10, background: "transparent", shadow: true, italic: false, underline: false, uppercase: false, align: "center", letterSpacing: 0, positionY: 48 },
  extra: { fontFamily: "Montserrat Local", fontSize: 54, fontWeight: 900, color: "#ffffff", strokeColor: "#080808", strokeWidth: 10, background: "transparent", shadow: true, italic: false, underline: false, uppercase: false, align: "center", letterSpacing: 0, positionY: 50 },
};

const TEXT_PRESETS = [
  { name: "Branco clássico", color: "#ffffff", strokeColor: "#080808", strokeWidth: 14, background: "transparent", shadow: true },
  { name: "Branco limpo", color: "#ffffff", strokeColor: "#ffffff", strokeWidth: 0, background: "transparent", shadow: true },
  { name: "Amarelo viral", color: "#ffe000", strokeColor: "#050505", strokeWidth: 14, background: "transparent", shadow: true },
  { name: "Vermelho", color: "#ff3b30", strokeColor: "#ffffff", strokeWidth: 9, background: "transparent", shadow: true },
  { name: "Azul", color: "#1689ff", strokeColor: "#ffffff", strokeWidth: 9, background: "transparent", shadow: true },
  { name: "Verde", color: "#18df4b", strokeColor: "#050505", strokeWidth: 12, background: "transparent", shadow: true },
  { name: "Tarja branca", color: "#111111", strokeColor: "#111111", strokeWidth: 0, background: "#ffffff", shadow: false },
  { name: "Tarja preta", color: "#ffffff", strokeColor: "#ffffff", strokeWidth: 0, background: "#080808", shadow: false },
  { name: "Destaque roxo", color: "#ffffff", strokeColor: "#ffffff", strokeWidth: 0, background: "#7415ff", shadow: true },
  { name: "Glow rosa", color: "#ffffff", strokeColor: "#ff2a78", strokeWidth: 8, background: "transparent", shadow: true },
] as const;

const DEFAULT_SETTINGS: EditorSettings = {
  title: "Dicas rápidas",
  category: "Cuidados com a pele",
  accent: "#f5c451",
  removeAudio: false,
  removeSilence: false,
  thresholdDb: -38,
  minimumSilence: 0.7,
  padding: 0.14,
  textStyles: DEFAULT_TEXT_STYLES,
  products: [
    { name: "Produto 1", label: "Bom" },
    { name: "Produto 2", label: "Melhor" },
    { name: "Produto 3", label: "Eu escolheria" },
  ],
};

const DEFAULT_QUESTION_BOX: QuestionBoxContent = {
  prompt: "Qual é a sua maior dúvida sobre\npele hoje?",
  answer: "Dra, uso vitamina C cara e minha pele\nnão melhora! Por quê?",
  borderEnabled: true,
  borderColor: "#ffffff",
  borderWidth: 6,
  borderRadius: 18,
};

const DEFAULT_CANVAS_LAYOUTS: CanvasLayouts = {
  title: { x: 50, y: 14, width: 90 },
  category: { x: 50, y: 76, width: 92 },
  "question-box": { x: 50, y: 27, width: 91 },
  // The watermark is tracked in its own state; this entry only satisfies the type.
  watermark: { x: 32, y: 91, width: 46 },
  "label-0": { x: 18, y: 49, width: 31 },
  "label-1": { x: 50, y: 49, width: 31 },
  "label-2": { x: 82, y: 49, width: 31 },
  "product-0": { x: 18, y: 69, width: 29 },
  "product-1": { x: 50, y: 69, width: 29 },
  "product-2": { x: 82, y: 69, width: 29 },
};

const FREE_CANVAS_LAYOUTS: CanvasLayouts = {
  ...DEFAULT_CANVAS_LAYOUTS,
  title: { x: 50, y: 18, width: 72 },
  category: { x: 50, y: 84, width: 72 },
};

const ROUTINE_PRODUCTS: Array<Pick<Product, "name" | "label">> = [
  { name: "Limpeza do dia", label: "1 – Sabonete ou gel\nde limpeza facial" },
  { name: "Antioxidante", label: "2 – Antioxidante\n(vitamina C)" },
  { name: "Hidratante do dia", label: "3 – Hidratante\n(ativos para o dia)" },
  { name: "Etapa complementar", label: "4 – Etapa complementar" },
  { name: "Protetor solar", label: "5 – Protetor solar" },
  { name: "Demaquilante", label: "1 – Demaquilante\nou cleansing oil" },
  { name: "Limpeza da noite", label: "2 – Sabonete ou gel\nde limpeza facial" },
  { name: "Tratamento noturno", label: "3 – Sérum noturno ou ácido\n(tratamento individual)" },
  { name: "Hidratante noturno", label: "4 – Hidratante\nmais intenso" },
];

const ROUTINE_CANVAS_LAYOUTS: CanvasLayouts = {
  ...DEFAULT_CANVAS_LAYOUTS,
  title: { x: 50, y: 8, width: 74 },
  category: { x: 50, y: 12.5, width: 62 },
  "label-0": { x: 20, y: 25, width: 38 },
  "product-0": { x: 40, y: 31, width: 16 },
  "label-1": { x: 20, y: 43, width: 38 },
  "product-1": { x: 9, y: 50, width: 15 },
  "label-2": { x: 22, y: 61, width: 40 },
  "product-2": { x: 41, y: 57, width: 17 },
  "label-3": { x: 20, y: 70, width: 35 },
  "product-3": { x: 39, y: 74, width: 15 },
  "label-4": { x: 21, y: 82, width: 40 },
  "product-4": { x: 23, y: 91, width: 13 },
  "label-5": { x: 74, y: 25, width: 42 },
  "product-5": { x: 91, y: 32, width: 14 },
  "label-6": { x: 76, y: 44, width: 40 },
  "product-6": { x: 61, y: 51, width: 17 },
  "label-7": { x: 75, y: 63, width: 42 },
  "product-7": { x: 91, y: 70, width: 15 },
  "label-8": { x: 76, y: 80, width: 40 },
  "product-8": { x: 62, y: 89, width: 14 },
};

const TIMED_RANKING_CANVAS_LAYOUTS = {
  ...DEFAULT_CANVAS_LAYOUTS,
  title: { x: 50, y: 13, width: 86 },
  category: { x: 50, y: 20, width: 80 },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `label-${index}`,
    { x: 50, y: 50, width: 32 },
  ])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `product-${index}`,
    { x: 50, y: 50, width: 26 },
  ])),
} as CanvasLayouts;

// Verified badge (scalloped seal + white check), viewBox 0 0 24 24.
const VERIFIED_SEAL_PATH = "M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72 3.1 5.53l.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21l3.4-1.46 3.61-.82-.34-3.68L23 12z";
const VERIFIED_CHECK_PATH = "M10.09 16.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z";
const DEFAULT_WATERMARK_LAYOUT: CanvasElementLayout = { x: 32, y: 91, width: 46 };

// Watermark proportions, all relative to the name font size (the base unit).
// Used identically in the live preview (cqw units) and in the export canvas
// (pixels) so what the person positions is exactly what gets rendered.
function watermarkMetrics(base: number, format: WatermarkFormat) {
  const compact = format === "compact";
  return {
    name: base,
    handle: base * .72,
    badge: base * (compact ? .92 : .82),
    photo: base * (compact ? 1.5 : 2.05),
    gap: base * (compact ? .38 : .5),
    lineGap: base * .12,
    nameHandleGap: base * .34,
  };
}

const VerifiedBadge = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
    <path d={VERIFIED_SEAL_PATH} fill="#1d9bf0" />
    <path d={VERIFIED_CHECK_PATH} fill="#ffffff" />
  </svg>
);

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="icon" aria-hidden="true">{children}</span>
);

function WaveformCanvas({ samples, color = "#66e0e1", quietColor = "#f4c94e", quietThreshold = .075, className = "" }: {
  samples: number[];
  color?: string;
  quietColor?: string;
  quietThreshold?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let frame = 0;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!samples.length) return;
      const center = height / 2;
      const maxAmplitude = Math.max(1, center - 1);
      // Thin rounded mirrored bars at pixel density: stays smooth and reveals
      // more detail the wider the track becomes when the timeline is zoomed.
      const barWidth = width > 640 ? 2 : 1.6;
      const gap = barWidth * .6;
      const step = barWidth + gap;
      const columns = Math.max(1, Math.floor(width / step));
      const radius = barWidth / 2;
      const inset = (width - columns * step + gap) / 2;
      for (let column = 0; column < columns; column += 1) {
        const from = Math.floor((column / columns) * samples.length);
        const to = Math.max(from + 1, Math.floor(((column + 1) / columns) * samples.length));
        let peak = 0;
        for (let index = from; index < to; index += 1) peak = Math.max(peak, samples[index] || 0);
        const quiet = peak < quietThreshold;
        const amplitude = Math.max(barWidth * .55, Math.pow(peak, .82) * maxAmplitude);
        const x = inset + column * step;
        context.globalAlpha = quiet ? .6 : 1;
        context.fillStyle = quiet ? quietColor : color;
        context.beginPath();
        if (context.roundRect) context.roundRect(x, center - amplitude, barWidth, amplitude * 2, radius);
        else context.rect(x, center - amplitude, barWidth, amplitude * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };
    draw();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [samples, color, quietColor, quietThreshold]);
  return <div ref={containerRef} className={`waveform-canvas ${className}`} aria-hidden="true"><canvas ref={canvasRef} /></div>;
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rankingProgress(time: number, index: number, settings: RankingSettings) {
  const revealTime = settings.revealMode === "all" ? settings.itemTimes[0] : settings.itemTimes[index];
  return clamp((time - (revealTime ?? 0)) / Math.max(.15, settings.motionDuration));
}

function rankingPartProgress(time: number, index: number, settings: RankingSettings, part: "number" | "media") {
  const revealTime = settings.revealMode === "all" ? settings.itemTimes[0] : settings.itemTimes[index];
  const delay = part === "media" && settings.displayMode === "numbers-first" ? settings.numberLeadTime : 0;
  return clamp((time - (revealTime ?? 0) - delay) / Math.max(.15, settings.motionDuration));
}

function rankingVisibility(time: number, index: number, settings: RankingSettings) {
  if (!Number.isFinite(time)) return 1;
  const start = settings.revealMode === "all" ? settings.itemTimes[0] : settings.itemTimes[index];
  const end = settings.itemEndTimes[index] ?? 9_999;
  if (time < start || time > end) return 0;
  return Math.min(1, Math.max(0, (end - time) / .18));
}

function completeRankingSettings(settings?: Partial<RankingSettings>): RankingSettings {
  return {
    ...DEFAULT_RANKING_SETTINGS,
    ...settings,
    itemTimes: Array.from({ length: 10 }, (_, index) => settings?.itemTimes?.[index] ?? DEFAULT_RANKING_TIMES[index]),
    itemEndTimes: Array.from({ length: 10 }, (_, index) => settings?.itemEndTimes?.[index] ?? 9_999),
    itemLayers: Array.from({ length: 10 }, (_, index) => settings?.itemLayers?.[index] ?? index),
    itemScales: Array.from({ length: 10 }, (_, index) => settings?.itemScales?.[index] ?? 1),
  };
}

function rankingMotionFrame(motion: RankingMotionId, progress: number, position: RankingPosition) {
  const eased = 1 - Math.pow(1 - progress, 3);
  const sideDirection = position === "right" ? 1 : -1;
  if (motion === "rise") return { x: 0, y: (1 - eased) * 95, scale: .88 + eased * .12, rotate: 0, opacity: clamp(progress * 2.4) };
  if (motion === "zoom") return { x: 0, y: 0, scale: .25 + eased * .75, rotate: 0, opacity: clamp(progress * 2.2) };
  if (motion === "bounce") {
    const back = 1 + 2.7 * Math.pow(progress - 1, 3) + 1.7 * Math.pow(progress - 1, 2);
    return { x: sideDirection * (1 - eased) * 85, y: 0, scale: .58 + back * .42, rotate: 0, opacity: clamp(progress * 2.6) };
  }
  if (motion === "spin") return { x: sideDirection * (1 - eased) * 70, y: 0, scale: .55 + eased * .45, rotate: sideDirection * (1 - eased) * 24, opacity: clamp(progress * 2.4) };
  return { x: sideDirection * (1 - eased) * 120, y: 0, scale: .92 + eased * .08, rotate: 0, opacity: clamp(progress * 2.5) };
}

function fileUrl(file?: File) {
  return file ? URL.createObjectURL(file) : undefined;
}

async function removeWhiteBackground(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const maximumSide = 4096;
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;

  const sampleSize = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  let backgroundRed = 0;
  let backgroundGreen = 0;
  let backgroundBlue = 0;
  let samples = 0;
  const corners = [[0, 0], [width - sampleSize, 0], [0, height - sampleSize], [width - sampleSize, height - sampleSize]];
  for (const [cornerX, cornerY] of corners) {
    for (let y = cornerY; y < cornerY + sampleSize; y++) {
      for (let x = cornerX; x < cornerX + sampleSize; x++) {
        const offset = (y * width + x) * 4;
        if (pixels[offset + 3] < 20) continue;
        backgroundRed += pixels[offset];
        backgroundGreen += pixels[offset + 1];
        backgroundBlue += pixels[offset + 2];
        samples++;
      }
    }
  }
  backgroundRed /= Math.max(1, samples);
  backgroundGreen /= Math.max(1, samples);
  backgroundBlue /= Math.max(1, samples);

  const backgroundLuminance = (backgroundRed + backgroundGreen + backgroundBlue) / 3;
  const backgroundSaturation = Math.max(backgroundRed, backgroundGreen, backgroundBlue) - Math.min(backgroundRed, backgroundGreen, backgroundBlue);
  if (backgroundLuminance < 232 || backgroundSaturation > 20) {
    return file;
  }
  const pixelCount = width * height;
  let noise = 0;
  for (const [cornerX, cornerY] of corners) {
    for (let y = cornerY; y < cornerY + sampleSize; y++) {
      for (let x = cornerX; x < cornerX + sampleSize; x++) {
        const offset = (y * width + x) * 4;
        noise += Math.hypot(pixels[offset] - backgroundRed, pixels[offset + 1] - backgroundGreen, pixels[offset + 2] - backgroundBlue);
      }
    }
  }
  noise /= Math.max(1, samples);
  const hardThreshold = Math.max(4.5, Math.min(9, noise * 1.8 + 3.5));
  const softThreshold = Math.max(10, Math.min(18, hardThreshold + 7));
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;

  const colorDistance = (index: number) => {
    const offset = index * 4;
    return Math.hypot(pixels[offset] - backgroundRed, pixels[offset + 1] - backgroundGreen, pixels[offset + 2] - backgroundBlue);
  };
  const isConservativeBackground = (index: number) => {
    if (visited[index]) return false;
    const x = index % width;
    const y = Math.floor(index / width);
    const offset = index * 4;
    if (pixels[offset + 3] < 20) return true;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const luminance = (red + green + blue) / 3;
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const distance = colorDistance(index);
    if (luminance < 224 || saturation > 28 || distance > softThreshold) return false;
    if (distance <= hardThreshold * .72) return true;
    let localContrast = 0;
    const neighbors = [x > 0 ? index - 1 : index, x < width - 1 ? index + 1 : index, y > 0 ? index - width : index, y < height - 1 ? index + width : index];
    for (const neighbor of neighbors) {
      const neighborOffset = neighbor * 4;
      localContrast = Math.max(localContrast, Math.hypot(red - pixels[neighborOffset], green - pixels[neighborOffset + 1], blue - pixels[neighborOffset + 2]));
    }
    return localContrast <= Math.max(8, hardThreshold * 1.25);
  };

  const enqueue = (index: number) => {
    if (!isConservativeBackground(index)) return;
    visited[index] = 1;
    queue[queueEnd++] = index;
  };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }
  if (queueEnd < pixelCount * .015) return file;
  for (let index = 0; index < pixelCount; index++) {
    if (!visited[index]) continue;
    const offset = index * 4;
    const distance = colorDistance(index);
    const feather = clamp((distance - hardThreshold) / Math.max(1, softThreshold - hardThreshold));
    pixels[offset + 3] = Math.round(pixels[offset + 3] * feather);
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Falha ao recortar imagem")), "image/png"),
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-sem-fundo.png", { type: "image/png" });
}

async function normalizeProductImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const sourceScale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const source = document.createElement("canvas");
  source.width = Math.max(1, Math.round(bitmap.width * sourceScale));
  source.height = Math.max(1, Math.round(bitmap.height * sourceScale));
  const sourceContext = source.getContext("2d", { willReadFrequently: true })!;
  sourceContext.drawImage(bitmap, 0, 0, source.width, source.height);
  bitmap.close();
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  let minimumX = source.width;
  let minimumY = source.height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (pixels[(y * source.width + x) * 4 + 3] < 18) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) return file;
  const cropWidth = maximumX - minimumX + 1;
  const cropHeight = maximumY - minimumY + 1;
  const targetWidth = 1800;
  const targetHeight = 2200;
  const target = document.createElement("canvas");
  target.width = targetWidth;
  target.height = targetHeight;
  const targetContext = target.getContext("2d")!;
  const scale = Math.min(targetWidth * .84 / cropWidth, targetHeight * .84 / cropHeight);
  const width = cropWidth * scale;
  const height = cropHeight * scale;
  targetContext.imageSmoothingEnabled = true;
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(
    source,
    minimumX,
    minimumY,
    cropWidth,
    cropHeight,
    (targetWidth - width) / 2,
    (targetHeight - height) / 2,
    width,
    height,
  );
  const blob = await new Promise<Blob>((resolve, reject) => target.toBlob((result) => result ? resolve(result) : reject(new Error("Falha ao padronizar produto")), "image/png"));
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-padronizado.png", { type: "image/png" });
}

function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(TEMPLATE_STORE)) {
        request.result.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readLocalTemplates(): Promise<SavedTemplate[]> {
  const database = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(TEMPLATE_STORE, "readonly").objectStore(TEMPLATE_STORE).getAll();
    request.onsuccess = () => {
      database.close();
      resolve((request.result as SavedTemplate[]).sort((a, b) => b.savedAt - a.savedAt));
    };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function writeLocalTemplate(template: SavedTemplate) {
  const database = await openLocalDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(TEMPLATE_STORE, "readwrite").objectStore(TEMPLATE_STORE).put(template);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

async function removeLocalTemplate(id: string) {
  const database = await openLocalDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(TEMPLATE_STORE, "readwrite").objectStore(TEMPLATE_STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

export default function Home() {
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [products, setProducts] = useState<Product[]>(DEFAULT_SETTINGS.products);
  const [videoFile, setVideoFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [activePanel, setActivePanel] = useState<"edit" | "text" | "audio" | "captions" | "broll" | "factory">("edit");
  const [textTarget, setTextTarget] = useState<TextTarget>("title");
  const [platform, setPlatform] = useState<keyof typeof SAFE_ZONES>("instagram");
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [templateMode, setTemplateMode] = useState<TemplateMode>("ranking");
  const [rankingSettings, setRankingSettings] = useState<RankingSettings>(() => completeRankingSettings());
  const [rankingScenes, setRankingScenes] = useState<RankingScene[]>([{ id: "ranking-scene-default", title: DEFAULT_SETTINGS.title, category: DEFAULT_SETTINGS.category, duration: 5 }]);
  const [selectedRankingScene, setSelectedRankingScene] = useState(0);
  const [routineHeadings, setRoutineHeadings] = useState<RoutineHeadings>({ day: "Dia ☀", night: "Noite ☾" });
  const [questionBox, setQuestionBox] = useState<QuestionBoxContent>(DEFAULT_QUESTION_BOX);
  const [extraTextLayers, setExtraTextLayers] = useState<ExtraTextLayer[]>([]);
  const [rankingScaleTarget, setRankingScaleTarget] = useState(0);
  const [canvasLayouts, setCanvasLayouts] = useState<CanvasLayouts>(DEFAULT_CANVAS_LAYOUTS);
  const [selectedElement, setSelectedElement] = useState<CanvasElementId | null>(null);
  const [unsafeTargets, setUnsafeTargets] = useState<TextTarget[]>([]);
  const [silentRanges, setSilentRanges] = useState<SilentRange[]>([]);
  const [cutHistory, setCutHistory] = useState<SilentRange[][]>([]);
  const [selectedCut, setSelectedCut] = useState<number | null>(null);
  const [reviewingCut, setReviewingCut] = useState<number | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [photoReelFile, setPhotoReelFile] = useState<File>();
  const [photoReelUrl, setPhotoReelUrl] = useState<string>();
  const [photoReelDuration, setPhotoReelDuration] = useState(10);
  const [photoReelStatus, setPhotoReelStatus] = useState<"idle" | "rendering">("idle");
  const [photoReelProgress, setPhotoReelProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] = useState<"idle" | "loading" | "transcribing" | "done" | "error">("idle");
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [transcriptionError, setTranscriptionError] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [whisperQuality, setWhisperQuality] = useState<"balanced" | "accurate">("accurate");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPresetId, setExportPresetId] = useState<ExportPresetId>("full-hd");
  const [brollClips, setBrollClips] = useState<BrollClip[]>([]);
  const [additionalVideoMode, setAdditionalVideoMode] = useState<"sequence" | "overlay">("sequence");
  const [brollLink, setBrollLink] = useState("");
  const [brollStatus, setBrollStatus] = useState<"idle" | "importing" | "analyzing">("idle");
  const [brollReference, setBrollReference] = useState("");
  const [videoLinkTarget, setVideoLinkTarget] = useState<"main" | "broll">("broll");
  const [cinematicLayout, setCinematicLayout] = useState<CinematicLayout>("replace");
  const [splitDirection, setSplitDirection] = useState<SplitDirection>("horizontal");
  const [splitPosition, setSplitPosition] = useState(50);
  const [splitBarSize, setSplitBarSize] = useState(7);
  const [splitBarColor, setSplitBarColor] = useState("#ffffff");
  const [brollPlacement, setBrollPlacement] = useState<"first" | "second">("second");
  const [mainVideoFocus, setMainVideoFocus] = useState<VideoFocus>({ x: 50, y: 50 });
  const [focusEditMode, setFocusEditMode] = useState(false);
  const [focusStatus, setFocusStatus] = useState<"idle" | "face" | "scene">("idle");
  const [reactMediaFile, setReactMediaFile] = useState<File>();
  const [reactMediaUrl, setReactMediaUrl] = useState<string>();
  const [reactMediaType, setReactMediaType] = useState<"video" | "image">("video");
  const [reactLayout, setReactLayout] = useState<ReactOverlayLayout>({ x: 5, y: 56, width: 54, height: 40, radius: 4 });
  const [reactRemoveBackground, setReactRemoveBackground] = useState(true);
  const [reactSegmentationStatus, setReactSegmentationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reactMaskThreshold, setReactMaskThreshold] = useState(.48);
  const [reactEdgeSoftness, setReactEdgeSoftness] = useState(.16);
  const [processingProduct, setProcessingProduct] = useState<number | null>(null);
  const [backgroundProgress, setBackgroundProgress] = useState(0);
  const [backgroundStage, setBackgroundStage] = useState("");
  const [productLink, setProductLink] = useState("");
  const [linkProductIndex, setLinkProductIndex] = useState(0);
  const [backgroundRemovalMode, setBackgroundRemovalMode] = useState<BackgroundRemovalMode>("white");
  const [importingLink, setImportingLink] = useState(false);
  const [harmonizingProducts, setHarmonizingProducts] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(390);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [waveformSamples, setWaveformSamples] = useState<number[]>([]);
  const [importedAudios, setImportedAudios] = useState<ImportedAudioTrack[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkName, setWatermarkName] = useState("Seu Nome");
  const [watermarkHandle, setWatermarkHandle] = useState("@seuusuario");
  const [watermarkVerified, setWatermarkVerified] = useState(true);
  const [watermarkFormat, setWatermarkFormat] = useState<WatermarkFormat>("full");
  const [watermarkTheme, setWatermarkTheme] = useState<"light" | "dark">("light");
  const [watermarkOpacity, setWatermarkOpacity] = useState(1);
  const [watermarkPhotoUrl, setWatermarkPhotoUrl] = useState("");
  const [watermarkLayout, setWatermarkLayout] = useState<CanvasElementLayout>(DEFAULT_WATERMARK_LAYOUT);
  const [factoryRemovedRanges, setFactoryRemovedRanges] = useState<FactoryRemovedRange[]>([]);
  const [factoryStructureRanges, setFactoryStructureRanges] = useState<FactoryStructureRange[]>([]);
  const [timelineSelection, setTimelineSelection] = useState<TimelineSelection | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextTarget } | null>(null);
  const [videoSplits, setVideoSplits] = useState<number[]>([]);
  const [mainSegmentOrder, setMainSegmentOrder] = useState<number[]>([0]);
  const [mainCrop, setMainCrop] = useState<MainCrop>({ zoom: 1, x: 50, y: 50 });
  const [cropControlsOpen, setCropControlsOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [audioExtracted, setAudioExtracted] = useState(false);
  const [timelineMarkers, setTimelineMarkers] = useState<TimelineMarker[]>([]);
  const [editorHistory, setEditorHistory] = useState<EditorSnapshot[]>([]);
  const [toast, setToast] = useState("");
  const [factoryClips, setFactoryClips] = useState<Record<FactorySection, FactoryClip[]>>({ hook: [], body: [], cta: [] });
  const [factoryInputMode, setFactoryInputMode] = useState<FactoryInputMode>("banks");
  const [singleFactoryFile, setSingleFactoryFile] = useState<File>();
  const [singleFactoryUrl, setSingleFactoryUrl] = useState<string>();
  const [singleFactoryHookCount, setSingleFactoryHookCount] = useState(3);
  const [singleFactoryStatus, setSingleFactoryStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [factoryGenerated, setFactoryGenerated] = useState(false);
  const [factorySelectedIds, setFactorySelectedIds] = useState<string[]>([]);
  const [factoryStyle, setFactoryStyle] = useState<FactoryStyle>("standard");
  const [factorySplitFile, setFactorySplitFile] = useState<File>();
  const [factorySplitUrl, setFactorySplitUrl] = useState<string>();
  const [factoryExporting, setFactoryExporting] = useState(false);
  const [factoryExportStatus, setFactoryExportStatus] = useState("");
  const [factoryExportProgress, setFactoryExportProgress] = useState(0);
  const [factoryProjects, setFactoryProjects] = useState<FactoryProject[]>([]);
  const [activeFactoryProjectId, setActiveFactoryProjectId] = useState<string | null>(null);
  const [activeFactorySequence, setActiveFactorySequence] = useState<[FactoryClip, FactoryClip, FactoryClip] | null>(null);
  const [factoryPreparing, setFactoryPreparing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const importedAudioInputRef = useRef<HTMLInputElement>(null);
  const importedAudioElsRef = useRef<Record<string, HTMLAudioElement | null>>({});
  const importedAudioBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const importedAudioDragRef = useRef<{ id: string; pointerId: number; startX: number; width: number; initialOffset: number } | null>(null);
  const watermarkPhotoInputRef = useRef<HTMLInputElement>(null);
  const watermarkInteractionRef = useRef<{ type: "drag" | "resize"; pointerId: number; startX: number; startY: number; layout: CanvasElementLayout; stageWidth: number; stageHeight: number } | null>(null);
  const timelineSelectionRef = useRef<TimelineSelection | null>(null);
  const deleteTimelineRef = useRef<(target: ContextTarget) => void>(() => {});
  const exportSceneRef = useRef<(superClip?: SuperClip) => Promise<void>>(async () => {});
  const pendingSceneVideoUrlRef = useRef<string>("");
  const playbackMonitorRef = useRef<number | null>(null);
  const playbackMonitorUsesRVFC = useRef(false);
  const advancePlaybackRef = useRef<() => void>(() => {});
  const dragRafRef = useRef(0);
  const dragTaskRef = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const brollInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const reactMediaInputRef = useRef<HTMLInputElement>(null);
  const reactTransparentCanvasRef = useRef<HTMLCanvasElement>(null);
  const reactSegmenterRef = useRef<MediaPipeImageSegmenter | null>(null);
  const reactMaskSettingsRef = useRef({ threshold: .48, softness: .16 });
  const reactMaskRevisionRef = useRef(0);
  const brollPreviewRef = useRef<HTMLVideoElement>(null);
  const cinematicImageInputRef = useRef<HTMLInputElement>(null);
  const focusDragRef = useRef<{
    pointerId: number;
    target: "main" | "broll";
    startX: number;
    startY: number;
    focusX: number;
    focusY: number;
    width: number;
    height: number;
    clipId?: string;
  } | null>(null);
  const reactOverlayDragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; stageWidth: number; stageHeight: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const categoryRef = useRef<HTMLHeadingElement>(null);
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const extraTextRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const interactionRef = useRef<{
    id: CanvasElementId;
    type: "drag" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    layout: CanvasElementLayout;
    stageWidth: number;
    stageHeight: number;
  } | null>(null);
  const timelineResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const playheadDragRef = useRef<number | null>(null);
  const activeMainOrderIndexRef = useRef(0);
  const draggedMainSegmentRef = useRef<number | null>(null);
  const knownVideoDurationRef = useRef(0);
  const timelineClipDragRef = useRef<{
    pointerId: number;
    kind: "ranking" | "broll";
    index?: number;
    id?: string;
    mode: "move" | "trim-start" | "trim-end";
    startX: number;
    startY: number;
    width: number;
    initialStart: number;
    initialEnd: number;
    initialLayer: number;
    initialSourceStart?: number;
  } | null>(null);
  const factoryTrimDragRef = useRef<{
    pointerId: number;
    index: number;
    edge: "start" | "end";
    startX: number;
    width: number;
    initialSequence: [FactoryClip, FactoryClip, FactoryClip];
    draftSequence: [FactoryClip, FactoryClip, FactoryClip];
  } | null>(null);
  const mainTrimDragRef = useRef<{ pointerId: number; index: number; edge: "start" | "end"; startX: number; width: number; initialBoundary: number; minimum: number; maximum: number } | null>(null);

  useEffect(() => {
    readLocalTemplates().then(setTemplates).catch(() => setTemplates([]));
    const storedTimelineHeight = Number(window.localStorage.getItem("clippronto-timeline-height"));
    if (Number.isFinite(storedTimelineHeight) && storedTimelineHeight >= 180) setTimelineHeight(storedTimelineHeight);
    const storedTimelineZoom = Number(window.localStorage.getItem("clippronto-timeline-zoom"));
    if (Number.isFinite(storedTimelineZoom) && storedTimelineZoom >= 1) setTimelineZoom(clamp(storedTimelineZoom, 1, 12));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    window.localStorage.setItem("clippronto-timeline-height", String(timelineHeight));
  }, [timelineHeight]);

  useEffect(() => {
    window.localStorage.setItem("clippronto-timeline-zoom", String(timelineZoom));
  }, [timelineZoom]);

  useEffect(() => {
    importedAudios.forEach((track) => {
      const audio = importedAudioElsRef.current[track.id];
      if (audio) audio.volume = clamp(track.volume, 0, 1);
    });
  }, [importedAudios]);

  useEffect(() => { timelineSelectionRef.current = timelineSelection; });
  useEffect(() => { deleteTimelineRef.current = deleteTimelineTarget; });
  useEffect(() => { advancePlaybackRef.current = advancePlaybackPosition; });
  useEffect(() => () => stopPlaybackMonitor(), []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setContextMenu(null); return; }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const selection = timelineSelectionRef.current;
      if (!selection) return;
      event.preventDefault();
      deleteTimelineRef.current(selection);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("clippronto-watermark");
      if (!stored) return;
      const data = JSON.parse(stored);
      if (typeof data.name === "string") setWatermarkName(data.name);
      if (typeof data.handle === "string") setWatermarkHandle(data.handle);
      if (typeof data.verified === "boolean") setWatermarkVerified(data.verified);
      if (data.format === "full" || data.format === "compact") setWatermarkFormat(data.format);
      if (data.theme === "light" || data.theme === "dark") setWatermarkTheme(data.theme);
      if (typeof data.opacity === "number") setWatermarkOpacity(clamp(data.opacity, .2, 1));
      if (data.layout && typeof data.layout.x === "number") setWatermarkLayout(data.layout);
    } catch { /* ignore corrupt storage */ }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("clippronto-watermark", JSON.stringify({
      name: watermarkName, handle: watermarkHandle, verified: watermarkVerified,
      format: watermarkFormat, theme: watermarkTheme, opacity: watermarkOpacity, layout: watermarkLayout,
    }));
  }, [watermarkName, watermarkHandle, watermarkVerified, watermarkFormat, watermarkTheme, watermarkOpacity, watermarkLayout]);

  useEffect(() => {
    syncImportedAudio(videoRef.current?.currentTime ?? currentTime, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, importedAudios, playbackSpeed]);

  useEffect(() => {
    if (!videoUrl) return;
    setTimelineCollapsed(false);
    setTimelineHeight((current) => Math.max(320, current));
  }, [videoUrl]);

  useEffect(() => {
    reactMaskSettingsRef.current = { threshold: reactMaskThreshold, softness: reactEdgeSoftness };
    reactMaskRevisionRef.current += 1;
  }, [reactMaskThreshold, reactEdgeSoftness]);

  useEffect(() => {
    if (templateMode !== "react" || !videoUrl || !reactRemoveBackground) {
      setReactSegmentationStatus("idle");
      const canvas = reactTransparentCanvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let cancelled = false;
    let animationFrame = 0;
    let lastProcessedAt = -Infinity;
    let lastVideoTime = -1;
    let lastMaskRevision = -1;
    const maskCanvas = document.createElement("canvas");
    const maskContext = maskCanvas.getContext("2d");
    setReactSegmentationStatus("loading");

    const prepareSegmenter = async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/models/selfie_segmenter.tflite" },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      if (cancelled) {
        segmenter.close();
        return;
      }
      reactSegmenterRef.current?.close();
      reactSegmenterRef.current = segmenter;

      const renderTransparentFrame = (timestamp: number) => {
        if (cancelled) return;
        const video = videoRef.current;
        const output = reactTransparentCanvasRef.current;
        const timeChanged = video && Math.abs(video.currentTime - lastVideoTime) > .0001;
        const settingsChanged = lastMaskRevision !== reactMaskRevisionRef.current;
        if (
          video && output && maskContext && video.readyState >= 2 && video.videoWidth > 0 &&
          (timeChanged || settingsChanged) && timestamp - lastProcessedAt >= 40
        ) {
          lastProcessedAt = timestamp;
          lastVideoTime = video.currentTime;
          lastMaskRevision = reactMaskRevisionRef.current;
          try {
            const result = segmenter.segmentForVideo(video, timestamp);
            const mask = result.confidenceMasks?.[0];
            if (mask) {
              const confidence = mask.getAsFloat32Array();
              const maskWidth = mask.width;
              const maskHeight = mask.height;
              if (maskCanvas.width !== maskWidth || maskCanvas.height !== maskHeight) {
                maskCanvas.width = maskWidth;
                maskCanvas.height = maskHeight;
              }
              const pixels = maskContext.createImageData(maskWidth, maskHeight);
              const { threshold, softness } = reactMaskSettingsRef.current;
              const low = Math.max(0, threshold - softness);
              const high = Math.min(1, threshold + softness);
              const span = Math.max(.001, high - low);
              for (let index = 0; index < confidence.length; index += 1) {
                const normalized = clamp((confidence[index] - low) / span, 0, 1);
                const alpha = normalized * normalized * (3 - 2 * normalized);
                const pixel = index * 4;
                pixels.data[pixel] = 255;
                pixels.data[pixel + 1] = 255;
                pixels.data[pixel + 2] = 255;
                pixels.data[pixel + 3] = Math.round(alpha * 255);
              }
              maskContext.putImageData(pixels, 0, 0);

              const outputWidth = Math.min(512, video.videoWidth);
              const outputHeight = Math.max(1, Math.round(outputWidth * video.videoHeight / video.videoWidth));
              if (output.width !== outputWidth || output.height !== outputHeight) {
                output.width = outputWidth;
                output.height = outputHeight;
              }
              const outputContext = output.getContext("2d");
              if (outputContext) {
                outputContext.clearRect(0, 0, output.width, output.height);
                outputContext.globalCompositeOperation = "source-over";
                outputContext.drawImage(maskCanvas, 0, 0, output.width, output.height);
                outputContext.globalCompositeOperation = "source-in";
                outputContext.drawImage(video, 0, 0, output.width, output.height);
                outputContext.globalCompositeOperation = "source-over";
                setReactSegmentationStatus((current) => current === "ready" ? current : "ready");
              }
            }
            result.close();
          } catch {
            setReactSegmentationStatus("error");
          }
        }
        animationFrame = requestAnimationFrame(renderTransparentFrame);
      };
      animationFrame = requestAnimationFrame(renderTransparentFrame);
    };

    void prepareSegmenter().catch(() => {
      if (!cancelled) setReactSegmentationStatus("error");
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      reactSegmenterRef.current?.close();
      reactSegmenterRef.current = null;
    };
  }, [templateMode, videoUrl, reactRemoveBackground]);

  useEffect(() => {
    if (!isPlaying || templateMode !== "timed-ranking") return;
    let frame = 0;
    let lastUpdate = 0;
    const syncRankingClock = (timestamp: number) => {
      const video = videoRef.current;
      if (video && timestamp - lastUpdate >= 30) {
        setCurrentTime(video.currentTime);
        lastUpdate = timestamp;
      }
      frame = requestAnimationFrame(syncRankingClock);
    };
    frame = requestAnimationFrame(syncRankingClock);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, templateMode]);

  useEffect(() => {
    const evaluateSafeArea = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      const zone = SAFE_ZONES[platform];
      const safe = {
        top: bounds.top + bounds.height * zone.top / 100,
        right: bounds.right - bounds.width * zone.right / 100,
        bottom: bounds.bottom - bounds.height * zone.bottom / 100,
        left: bounds.left + bounds.width * zone.left / 100,
      };
      const outside = (element: Element | null) => {
        if (!element) return false;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rectangle = range.getBoundingClientRect();
        const visualPadding = Math.max(3, bounds.width * .012);
        return rectangle.top - visualPadding < safe.top || rectangle.bottom + visualPadding > safe.bottom || rectangle.left - visualPadding < safe.left || rectangle.right + visualPadding > safe.right;
      };
      const next: TextTarget[] = [];
      if (outside(titleRef.current)) next.push("title");
      if (outside(categoryRef.current)) next.push("category");
      if (labelRefs.current.some(outside)) next.push("labels");
      if (Object.values(extraTextRefs.current).some(outside)) next.push("extra");
      setUnsafeTargets(next);
    };
    const frame = requestAnimationFrame(evaluateSafeArea);
    const observer = new ResizeObserver(evaluateSafeArea);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", evaluateSafeArea);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", evaluateSafeArea);
    };
  }, [platform, settings, products, extraTextLayers, videoUrl, canvasLayouts]);

  const removedSeconds = useMemo(
    () => silentRanges.reduce((total, range) => total + range.end - range.start, 0),
    [silentRanges],
  );
  const videoSegments = useMemo(() => {
    const boundaries = [0, ...videoSplits.filter((time) => time > .05 && time < videoDuration - .05).sort((a, b) => a - b), videoDuration];
    return boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }));
  }, [videoDuration, videoSplits]);
  const orderedVideoSegments = useMemo(() => {
    const ordered = mainSegmentOrder
      .map((start) => videoSegments.find((segment) => Math.abs(segment.start - start) < .08))
      .filter((segment): segment is { start: number; end: number } => Boolean(segment));
    const missing = videoSegments.filter((segment) => !ordered.some((item) => Math.abs(item.start - segment.start) < .08));
    return [...ordered, ...missing];
  }, [mainSegmentOrder, videoSegments]);
  const mainTimelineCurrentTime = useMemo(() => {
    const activeIndex = Math.max(0, orderedVideoSegments.findIndex((segment) => currentTime >= segment.start - .04 && currentTime <= segment.end + .04));
    return orderedVideoSegments.slice(0, activeIndex).reduce((total, segment) => total + segment.end - segment.start, 0)
      + Math.max(0, currentTime - (orderedVideoSegments[activeIndex]?.start || 0));
  }, [currentTime, orderedVideoSegments]);
  const selectedExtraTextId = selectedElement?.startsWith("extra-text-") ? selectedElement.slice("extra-text-".length) : null;
  const selectedExtraText = selectedExtraTextId ? extraTextLayers.find((layer) => layer.id === selectedExtraTextId) : undefined;
  const activeTextStyle = selectedExtraText?.style || settings.textStyles[textTarget] || DEFAULT_TEXT_STYLES.extra;
  const safeZone = SAFE_ZONES[platform];
  const activeTextElementId: CanvasElementId = selectedElement?.startsWith("extra-text-")
    ? selectedElement
    : textTarget === "title" || textTarget === "category"
    ? textTarget
    : selectedElement?.startsWith("label-") ? selectedElement : "label-0";
  const activeBroll = useMemo(
    () => [...brollClips]
      .filter((clip) => (clip.placement || "overlay") === "overlay")
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
      .find((clip) => currentTime >= clip.timelineStart && currentTime < clip.timelineStart + clip.duration),
    [brollClips, currentTime],
  );
  const visibleProducts = templateMode === "timed-ranking" ? products.slice(0, rankingSettings.count) : products;
  const rankingSceneStarts = useMemo(() => rankingScenes.map((_, index) => rankingScenes.slice(0, index).reduce((total, scene) => total + scene.duration, 0)), [rankingScenes]);
  const activeRankingSceneIndex = templateMode === "ranking"
    ? (videoFile ? (() => {
      const found = rankingScenes.findIndex((scene, index) => currentTime >= rankingSceneStarts[index] && currentTime < rankingSceneStarts[index] + scene.duration);
      return found >= 0 ? found : Math.max(0, rankingScenes.length - 1);
    })() : selectedRankingScene)
    : 0;
  const activeRankingScene = rankingScenes[Math.min(activeRankingSceneIndex, rankingScenes.length - 1)] || rankingScenes[0];
  const activeTitle = templateMode === "ranking" && rankingScenes.length > 1 ? activeRankingScene?.title || settings.title : settings.title;
  const activeCategory = templateMode === "ranking" && rankingScenes.length > 1 ? activeRankingScene?.category || settings.category : settings.category;
  const rankingSceneProductIndexes = templateMode === "ranking" && rankingScenes.length > 1
    ? products.map((_, index) => index).filter((index) => Math.floor(index / 3) === Math.min(activeRankingSceneIndex, 3))
    : products.map((_, index) => index);
  const rankingPreviewTime = videoFile ? currentTime : Number.POSITIVE_INFINITY;
  const timelineVisibleHeight = timelineCollapsed ? 58 : timelineHeight;
  const timelineTickCount = Math.max(5, Math.round(timelineZoom * 4) + 1);
  const rankingTrackHeight = Math.max(76, (Math.max(0, ...rankingSettings.itemLayers.slice(0, rankingSettings.count)) + 1) * 25 + 12);
  const brollTrackHeight = Math.max(53, (Math.max(0, ...brollClips.filter((clip) => (clip.placement || "overlay") === "overlay").map((clip) => clip.layer ?? 0)) + 1) * 25 + 12);
  const sequenceVideoClips = useMemo(() => brollClips.filter((clip) => clip.placement === "sequence"), [brollClips]);
  const overlayVideoClips = useMemo(() => brollClips.filter((clip) => (clip.placement || "overlay") === "overlay"), [brollClips]);
  const selectedRankingIndex = timelineSelection?.kind === "ranking" ? timelineSelection.index : null;
  const selectedMainSegment = timelineSelection?.kind === "main" ? orderedVideoSegments[timelineSelection.index] : null;
  const selectedBrollClip = timelineSelection?.kind === "broll" ? brollClips.find((clip) => clip.id === timelineSelection.id) : null;
  const activeFactoryProject = activeFactoryProjectId ? factoryProjects.find((project) => project.id === activeFactoryProjectId) : undefined;
  const factorySequenceDuration = useMemo(() => activeFactorySequence?.reduce((total, clip) => total + Math.max(.1, clip.duration - clip.removedSeconds), 0) || 0, [activeFactorySequence]);
  const selectedFactoryClip = timelineSelection?.kind === "factory" ? activeFactorySequence?.[timelineSelection.index] : undefined;
  const factoryVariants = useMemo<FactoryVariant[]>(() => {
    const variants: FactoryVariant[] = [];
    const readyHooks = factoryClips.hook.filter((clip) => clip.status === "ready");
    const readyBodies = factoryClips.body.filter((clip) => clip.status === "ready");
    const readyCtas = factoryClips.cta.filter((clip) => clip.status === "ready");
    for (const hook of readyHooks) {
      for (const body of readyBodies) {
        for (const cta of readyCtas) {
          variants.push({
            id: `${hook.id}:${body.id}:${cta.id}`,
            hook,
            body,
            cta,
            duration: Math.max(0, hook.duration - hook.removedSeconds) + Math.max(0, body.duration - body.removedSeconds) + Math.max(0, cta.duration - cta.removedSeconds),
          });
        }
      }
    }
    return variants;
  }, [factoryClips]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackSpeed;
  }, [playbackSpeed, videoUrl]);

  function currentEditorSnapshot(): EditorSnapshot {
    return {
      silentRanges: silentRanges.map((range) => ({ ...range })),
      videoSplits: [...videoSplits],
      mainSegmentOrder: [...mainSegmentOrder],
      mainCrop: { ...mainCrop },
      playbackSpeed,
      audioExtracted,
      removeAudio: settings.removeAudio,
      brollClips: brollClips.map((clip) => ({ ...clip })),
      markers: timelineMarkers.map((marker) => ({ ...marker })),
    };
  }

  function pushEditorHistory() {
    const snapshot = currentEditorSnapshot();
    setEditorHistory((history) => [...history.slice(-29), snapshot]);
  }

  function restoreEditorSnapshot(snapshot: EditorSnapshot) {
    setSilentRanges(snapshot.silentRanges.map((range) => ({ ...range })));
    setVideoSplits([...snapshot.videoSplits]);
    setMainSegmentOrder([...snapshot.mainSegmentOrder]);
    setMainCrop({ ...snapshot.mainCrop });
    setMainVideoFocus({ x: snapshot.mainCrop.x, y: snapshot.mainCrop.y });
    setPlaybackSpeed(snapshot.playbackSpeed);
    setAudioExtracted(snapshot.audioExtracted);
    setBrollClips(snapshot.brollClips.map((clip) => ({ ...clip })));
    setTimelineMarkers(snapshot.markers.map((marker) => ({ ...marker })));
    setSettings((current) => ({ ...current, removeAudio: snapshot.removeAudio, removeSilence: snapshot.silentRanges.length > 0 }));
    setTimelineSelection(null);
  }

  function undoEditorChange() {
    const previous = editorHistory[editorHistory.length - 1];
    if (!previous) return;
    restoreEditorSnapshot(previous);
    setEditorHistory((history) => history.slice(0, -1));
    setToast("Última alteração do editor desfeita");
  }

  function resetEditorChanges() {
    pushEditorHistory();
    setSilentRanges([]);
    setVideoSplits([]);
    setMainSegmentOrder([0]);
    setMainCrop({ zoom: 1, x: 50, y: 50 });
    setMainVideoFocus({ x: 50, y: 50 });
    setPlaybackSpeed(1);
    setAudioExtracted(false);
    setTimelineMarkers([]);
    setBrollClips([]);
    setSettings((current) => ({ ...current, removeAudio: false, removeSilence: false }));
    setTimelineSelection(null);
    setToast("Editor restaurado ao estado inicial do vídeo");
  }

  function patchRankingSettings(patch: Partial<RankingSettings>) {
    setRankingSettings((current) => ({ ...current, ...patch }));
  }

  function rankingItemStyle(index: number): React.CSSProperties {
    const visibility = rankingVisibility(rankingPreviewTime, index, rankingSettings);
    return { opacity: visibility, pointerEvents: visibility <= 0 ? "none" : "auto" };
  }

  function rankingPartStyle(index: number, part: "number" | "media"): React.CSSProperties {
    const progress = rankingPartProgress(rankingPreviewTime, index, rankingSettings, part);
    const frame = rankingMotionFrame(rankingSettings.motion, progress, rankingSettings.position);
    const itemScale = part === "media" ? rankingSettings.itemScales[index] ?? 1 : 1;
    return {
      opacity: frame.opacity,
      transform: `translate(${frame.x}%, ${frame.y}%) scale(${frame.scale * itemScale}) rotate(${frame.rotate}deg)`,
      pointerEvents: progress <= 0 ? "none" : "auto",
    };
  }

  useEffect(() => {
    const preview = brollPreviewRef.current;
    if (!preview || !activeBroll || preview.readyState === 0) return;
    const target = activeBroll.sourceStart + Math.max(0, currentTime - activeBroll.timelineStart);
    if (Math.abs(preview.currentTime - target) > .3) preview.currentTime = target;
    if (isPlaying) preview.play().catch(() => undefined);
    else preview.pause();
  }, [activeBroll, currentTime, isPlaying]);

  function patchSettings(patch: Partial<EditorSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function patchTextStyle(patch: Partial<TextStyle>) {
    if (selectedExtraTextId) {
      setExtraTextLayers((current) => current.map((layer) => layer.id === selectedExtraTextId ? { ...layer, style: { ...layer.style, ...patch } } : layer));
      return;
    }
    setSettings((current) => ({
      ...current,
      textStyles: {
        ...current.textStyles,
        [textTarget]: { ...current.textStyles[textTarget], ...patch },
      },
    }));
  }

  function patchActiveTextPosition(positionY: number) {
    setCanvasLayouts((current) => ({
      ...current,
      [activeTextElementId]: { ...current[activeTextElementId], y: positionY },
    }));
    patchTextStyle({ positionY });
  }

  function rotateProduct(elementId: CanvasElementId, amount = 15) {
    if (!elementId.startsWith("product-")) return;
    setCanvasLayouts((current) => {
      const layout = current[elementId] || { x: 50, y: 50, width: 28, rotation: 0 };
      return { ...current, [elementId]: { ...layout, rotation: ((layout.rotation || 0) + amount + 360) % 360 } };
    });
    setSelectedElement(elementId);
    setToast(`Produto girado ${amount > 0 ? "para a direita" : "para a esquerda"}`);
  }

  function addRankingProduct() {
    if (products.length >= 10) return setToast("O ranking já chegou ao limite de 10 produtos");
    const index = products.length;
    const slot = index % 3;
    const positions = [18, 50, 82];
    const labelId = `label-${index}` as CanvasElementId;
    const productId = `product-${index}` as CanvasElementId;
    setProducts((current) => [...current, { name: `Produto ${index + 1}`, label: index % 3 === 0 ? "Bom" : index % 3 === 1 ? "Melhor" : "Eu escolheria" }]);
    setCanvasLayouts((current) => ({
      ...current,
      [labelId]: { x: positions[slot], y: 49, width: 31, rotation: 0 },
      [productId]: { x: positions[slot], y: 69, width: 29, rotation: 0 },
    }));
    setToast(`Produto ${index + 1} adicionado ao ranking`);
  }

  function addRankingScene() {
    if (rankingScenes.length >= 10) return setToast("O limite é de 10 títulos e categorias");
    const firstScene = rankingScenes[0];
    const normalized = rankingScenes.length === 1 ? [{ ...firstScene, title: settings.title, category: settings.category }] : rankingScenes;
    const nextIndex = normalized.length;
    const next = [...normalized, { id: crypto.randomUUID(), title: `Título principal ${nextIndex + 1}`, category: `Categoria ${nextIndex + 1}`, duration: 5 }];
    setRankingScenes(next);
    setSelectedRankingScene(nextIndex);
    const start = next.slice(0, nextIndex).reduce((total, scene) => total + scene.duration, 0);
    if (videoFile) seekVideo(Math.min(start, videoDuration));
    setToast(`Novo quadro de título e categoria adicionado`);
  }

  function updateRankingScene(index: number, patch: Partial<RankingScene>) {
    setRankingScenes((current) => current.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene));
    if (index === 0 && rankingScenes.length === 1) {
      if (patch.title !== undefined) patchSettings({ title: patch.title });
      if (patch.category !== undefined) patchSettings({ category: patch.category });
    }
  }

  function removeRankingScene(index: number) {
    if (rankingScenes.length <= 1) return;
    setRankingScenes((current) => current.filter((_, sceneIndex) => sceneIndex !== index));
    setSelectedRankingScene((current) => Math.max(0, Math.min(current, rankingScenes.length - 2)));
    setToast("Quadro removido");
  }

  function selectCanvasElement(id: CanvasElementId) {
    setSelectedElement(id);
    if (id.startsWith("extra-text-")) {
      setTextTarget("extra");
      setActivePanel("text");
    } else if (id === "title" || id === "category") {
      setTextTarget(id);
      setActivePanel("text");
    } else if (id.startsWith("label-")) {
      setTextTarget("labels");
      setActivePanel("text");
    } else {
      setActivePanel("edit");
    }
  }

  function addExtraText(initialText = "Novo texto") {
    const id = crypto.randomUUID();
    const elementId = `extra-text-${id}` as CanvasElementId;
    const cascade = extraTextLayers.length % 6;
    setExtraTextLayers((current) => [...current, {
      id,
      text: initialText,
      style: { ...DEFAULT_TEXT_STYLES.extra, positionY: 36 + cascade * 8 },
    }]);
    setCanvasLayouts((current) => ({ ...current, [elementId]: { x: 50, y: 36 + cascade * 8, width: 72 } }));
    setSelectedElement(elementId);
    setTextTarget("extra");
    setActivePanel("text");
    setToast("Texto livre adicionado");
  }

  function updateExtraText(id: string, text: string) {
    setExtraTextLayers((current) => current.map((layer) => layer.id === id ? { ...layer, text } : layer));
  }

  function removeExtraText(id: string) {
    const elementId = `extra-text-${id}` as CanvasElementId;
    setExtraTextLayers((current) => current.filter((layer) => layer.id !== id));
    setCanvasLayouts((current) => {
      const next = { ...current };
      delete next[elementId];
      return next;
    });
    if (selectedExtraTextId === id) {
      setSelectedElement(null);
      setTextTarget("title");
    }
    setToast("Texto livre removido");
  }

  function beginCanvasInteraction(event: React.PointerEvent<HTMLElement>, id: CanvasElementId, type: "drag" | "resize") {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = stage.getBoundingClientRect();
    interactionRef.current = {
      id,
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout: { ...(canvasLayouts[id] || { x: 50, y: 50, width: 72 }) },
      stageWidth: bounds.width,
      stageHeight: bounds.height,
    };
    selectCanvasElement(id);
  }

  function moveCanvasInteraction(event: React.PointerEvent<HTMLElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - interaction.startX) / interaction.stageWidth * 100;
    const deltaY = (event.clientY - interaction.startY) / interaction.stageHeight * 100;
    setCanvasLayouts((current) => {
      const layout = interaction.layout;
      const next = interaction.type === "drag"
        ? {
            ...layout,
            x: Math.max(layout.width / 2, Math.min(100 - layout.width / 2, layout.x + deltaX)),
            y: Math.max(2, Math.min(98, layout.y + deltaY)),
          }
        : { ...layout, width: Math.max(interaction.id === "question-box" ? 40 : 8, Math.min(98, layout.width + deltaX * 2)) };
      return { ...current, [interaction.id]: next };
    });
  }

  function endCanvasInteraction(event: React.PointerEvent<HTMLElement>) {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function activateRankingTemplate() {
    setTemplateMode("ranking");
    setExtraTextLayers([]);
    setSettings(DEFAULT_SETTINGS);
    setProducts(DEFAULT_SETTINGS.products);
    setCanvasLayouts(DEFAULT_CANVAS_LAYOUTS);
    setRankingScenes([{ id: "ranking-scene-default", title: DEFAULT_SETTINGS.title, category: DEFAULT_SETTINGS.category, duration: 5 }]);
    setSelectedRankingScene(0);
    setSelectedElement(null);
    setToast("Modelo Ranking carregado");
  }

  function activateTimedRankingTemplate() {
    const rankingProducts = Array.from({ length: 10 }, (_, index) => ({
      name: `Item ${index + 1}`,
      label: "",
    }));
    setTemplateMode("timed-ranking");
    setExtraTextLayers([]);
    setRankingSettings(completeRankingSettings());
    setSettings({
      ...DEFAULT_SETTINGS,
      title: "Classificando os melhores",
      category: "",
      products: rankingProducts,
      textStyles: {
        ...DEFAULT_TEXT_STYLES,
        title: { ...DEFAULT_TEXT_STYLES.title, fontSize: 72, strokeWidth: 13 },
      },
    });
    setProducts(rankingProducts);
    setCanvasLayouts(TIMED_RANKING_CANVAS_LAYOUTS);
    setSelectedElement(null);
    setActivePanel("edit");
    setTextTarget("title");
    setToast("Modelo Ranking Animado carregado");
  }

  function updateRankingTime(index: number, value: number) {
    setRankingSettings((current) => ({
      ...current,
      itemTimes: current.itemTimes.map((time, itemIndex) => itemIndex === index ? Math.max(0, value) : time),
      itemEndTimes: current.itemEndTimes.map((end, itemIndex) => {
        if (current.revealMode === "all") return end <= value ? value + Math.max(.5, current.motionDuration) : end;
        return itemIndex === index && end <= value ? value + Math.max(.5, current.motionDuration) : end;
      }),
    }));
  }

  function distributeRankingTimes() {
    if (!videoDuration) {
      setToast("Adicione um vídeo para distribuir os tempos automaticamente");
      return;
    }
    const count = rankingSettings.count;
    const start = Math.min(1, Math.max(0, videoDuration * .05));
    const end = videoDuration > 2 ? videoDuration - 1 : Math.max(start, videoDuration);
    const nextTimes = rankingSettings.itemTimes.map((time, index) => index < count
      ? start + (end - start) * index / Math.max(1, count - 1)
      : time,
    );
    const nextEndTimes = rankingSettings.itemEndTimes.map((time, index) => index < count && time <= nextTimes[index] ? videoDuration : time);
    patchRankingSettings({ itemTimes: nextTimes, itemEndTimes: nextEndTimes });
    setToast("Entradas distribuídas pela duração do vídeo");
  }

  function activateFreeTemplate() {
    setTemplateMode("free");
    setExtraTextLayers([]);
    setSettings({
      ...DEFAULT_SETTINGS,
      title: "Clique para editar",
      category: "",
      products: DEFAULT_SETTINGS.products.map((product) => ({ ...product, label: "" })),
    });
    setProducts(DEFAULT_SETTINGS.products.map((product) => ({ ...product, label: "" })));
    setCanvasLayouts(FREE_CANVAS_LAYOUTS);
    setSelectedElement("title");
    setActivePanel("text");
    setTextTarget("title");
    setToast("Modelo livre pronto para criar");
  }

  function activateQuestionBoxTemplate() {
    const emptyProducts = DEFAULT_SETTINGS.products.map((_, index) => ({ name: `Imagem ${index + 1}`, label: "" }));
    setTemplateMode("question-box");
    setQuestionBox({ ...DEFAULT_QUESTION_BOX });
    setExtraTextLayers([]);
    setSettings({ ...DEFAULT_SETTINGS, title: "Caixinha de pergunta", category: "", products: emptyProducts });
    setProducts(emptyProducts);
    setCanvasLayouts({ ...DEFAULT_CANVAS_LAYOUTS, "question-box": { x: 50, y: 27, width: 91 } });
    setSelectedElement("question-box");
    setActivePanel("edit");
    setToast("Modelo Caixinha de pergunta carregado · arraste para posicionar");
  }

  function activateCinematicTemplate() {
    setTemplateMode("cinematic");
    setExtraTextLayers([]);
    const emptyProducts = DEFAULT_SETTINGS.products.map((_, index) => ({ name: `Imagem ${index + 1}`, label: "" }));
    setSettings({ ...DEFAULT_SETTINGS, title: "", category: "", products: emptyProducts });
    setProducts(emptyProducts);
    setCanvasLayouts(FREE_CANVAS_LAYOUTS);
    setSelectedElement(null);
    setActivePanel("broll");
    setToast("Tela cinematográfica vazia pronta para criar");
  }

  function activateReactTemplate() {
    setTemplateMode("react");
    setExtraTextLayers([]);
    const emptyProducts = DEFAULT_SETTINGS.products.map((_, index) => ({ name: `Imagem ${index + 1}`, label: "" }));
    setSettings({ ...DEFAULT_SETTINGS, title: "", category: "", products: emptyProducts });
    setProducts(emptyProducts);
    setCanvasLayouts(FREE_CANVAS_LAYOUTS);
    setReactLayout({ x: 5, y: 56, width: 54, height: 40, radius: 4 });
    setReactRemoveBackground(true);
    setReactSegmentationStatus(videoUrl ? "loading" : "idle");
    setSelectedElement(null);
    setActivePanel("edit");
    setToast("Modelo React pronto · o fundo do apresentador será removido automaticamente");
  }

  function chooseReactMedia(file?: File) {
    if (!file || (!file.type.startsWith("video/") && !file.type.startsWith("image/"))) {
      setToast("Escolha um vídeo ou uma imagem");
      return;
    }
    if (reactMediaUrl) URL.revokeObjectURL(reactMediaUrl);
    setReactMediaFile(file);
    setReactMediaUrl(URL.createObjectURL(file));
    setReactMediaType(file.type.startsWith("image/") ? "image" : "video");
    setToast(file.type.startsWith("image/") ? "Imagem adicionada ao fundo do React" : "Vídeo adicional adicionado ao fundo do React");
  }

  function beginReactOverlayDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (templateMode !== "react") return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    reactOverlayDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: reactLayout.x, y: reactLayout.y, stageWidth: bounds.width, stageHeight: bounds.height };
  }

  function moveReactOverlayDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = reactOverlayDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const x = drag.x + (event.clientX - drag.startX) / drag.stageWidth * 100;
    const y = drag.y + (event.clientY - drag.startY) / drag.stageHeight * 100;
    setReactLayout((current) => ({ ...current, x: clamp(x, 0, 100 - current.width), y: clamp(y, 0, 100 - current.height) }));
  }

  function endReactOverlayDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (reactOverlayDragRef.current?.pointerId !== event.pointerId) return;
    reactOverlayDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function activateRoutineTemplate() {
    const products = ROUTINE_PRODUCTS.map((product) => ({ ...product }));
    setTemplateMode("routine");
    setExtraTextLayers([]);
    setRoutineHeadings({ day: "Dia ☀", night: "Noite ☾" });
    setSettings({
      ...DEFAULT_SETTINGS,
      title: "Ordem correta",
      category: "SKINCARE",
      products,
      textStyles: {
        title: { ...DEFAULT_TEXT_STYLES.title, fontSize: 58, strokeWidth: 11 },
        category: { ...DEFAULT_TEXT_STYLES.category, fontSize: 64, color: "#ffe000", strokeWidth: 12 },
        labels: { ...DEFAULT_TEXT_STYLES.labels, fontSize: 40, strokeWidth: 9, letterSpacing: -1 },
        extra: { ...DEFAULT_TEXT_STYLES.extra },
      },
    });
    setProducts(products);
    setCanvasLayouts(ROUTINE_CANVAS_LAYOUTS);
    setSelectedElement(null);
    setActivePanel("edit");
    setToast("Modelo Rotina Dia & Noite carregado");
  }

  function activateTemplateMode(mode: TemplateMode) {
    if (mode === "ranking") activateRankingTemplate();
    else if (mode === "timed-ranking") activateTimedRankingTemplate();
    else if (mode === "free") activateFreeTemplate();
    else if (mode === "cinematic") activateCinematicTemplate();
    else if (mode === "react") activateReactTemplate();
    else if (mode === "routine") activateRoutineTemplate();
    else activateQuestionBoxTemplate();
  }

  function captureSceneData(): SceneData {
    return {
      mode: templateMode,
      settings: { ...settings, textStyles: { ...settings.textStyles }, products: settings.products.map((product) => ({ ...product })) },
      products: products.map((product) => ({ ...product })),
      canvasLayouts: { ...canvasLayouts },
      rankingSettings: { ...rankingSettings, itemTimes: [...rankingSettings.itemTimes], itemEndTimes: [...rankingSettings.itemEndTimes], itemLayers: [...rankingSettings.itemLayers], itemScales: [...rankingSettings.itemScales] },
      rankingScenes: rankingScenes.map((scene) => ({ ...scene })),
      selectedRankingScene,
      routineHeadings: { ...routineHeadings },
      questionBox: { ...questionBox },
      extraTextLayers: extraTextLayers.map((layer) => ({ ...layer, style: { ...layer.style } })),
      rankingScaleTarget,
      videoFile,
      videoUrl,
      videoDuration,
      silentRanges: silentRanges.map((range) => ({ ...range })),
      videoSplits: [...videoSplits],
      mainSegmentOrder: [...mainSegmentOrder],
      mainCrop: { ...mainCrop },
      mainVideoFocus: { ...mainVideoFocus },
      playbackSpeed,
      audioExtracted,
      brollClips: brollClips.map((clip) => ({ ...clip })),
      timelineMarkers: timelineMarkers.map((marker) => ({ ...marker })),
      reactMediaFile,
      reactMediaUrl,
      reactMediaType,
      reactLayout: { ...reactLayout },
      reactRemoveBackground,
      reactMaskThreshold,
      reactEdgeSoftness,
      photoReelFile,
      photoReelUrl,
      photoReelDuration,
      cinematicLayout,
      splitDirection,
      splitPosition,
      splitBarSize,
      splitBarColor,
      brollPlacement,
    };
  }

  function applySceneData(data: SceneData) {
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    setTemplateMode(data.mode);
    setSettings({ ...data.settings, textStyles: { ...data.settings.textStyles }, products: data.settings.products.map((product) => ({ ...product })) });
    setProducts(data.products.map((product) => ({ ...product })));
    setCanvasLayouts({ ...data.canvasLayouts });
    setRankingSettings({ ...data.rankingSettings });
    setRankingScenes(data.rankingScenes.map((scene) => ({ ...scene })));
    setSelectedRankingScene(data.selectedRankingScene);
    setRoutineHeadings({ ...data.routineHeadings });
    setQuestionBox({ ...data.questionBox });
    setExtraTextLayers(data.extraTextLayers.map((layer) => ({ ...layer, style: { ...layer.style } })));
    setRankingScaleTarget(data.rankingScaleTarget);
    // Recreate blob URLs from the durable Files: a scene's stored URL may have
    // been revoked when another scene loaded its own media.
    const nextVideoUrl = data.videoFile ? URL.createObjectURL(data.videoFile) : (data.videoUrl || undefined);
    pendingSceneVideoUrlRef.current = nextVideoUrl || "";
    setVideoFile(data.videoFile);
    setVideoUrl(nextVideoUrl);
    knownVideoDurationRef.current = data.videoDuration;
    setVideoDuration(data.videoDuration);
    setSilentRanges(data.silentRanges.map((range) => ({ ...range })));
    setVideoSplits([...data.videoSplits]);
    setMainSegmentOrder([...data.mainSegmentOrder]);
    setMainCrop({ ...data.mainCrop });
    setMainVideoFocus({ ...data.mainVideoFocus });
    setPlaybackSpeed(data.playbackSpeed);
    setAudioExtracted(data.audioExtracted);
    setBrollClips(data.brollClips.map((clip) => ({ ...clip })));
    setTimelineMarkers(data.timelineMarkers.map((marker) => ({ ...marker })));
    setReactMediaFile(data.reactMediaFile);
    setReactMediaUrl(data.reactMediaFile ? URL.createObjectURL(data.reactMediaFile) : data.reactMediaUrl);
    setReactMediaType(data.reactMediaType);
    setReactLayout({ ...data.reactLayout });
    setReactRemoveBackground(data.reactRemoveBackground);
    setReactMaskThreshold(data.reactMaskThreshold);
    setReactEdgeSoftness(data.reactEdgeSoftness);
    setPhotoReelFile(data.photoReelFile);
    setPhotoReelUrl(data.photoReelFile ? URL.createObjectURL(data.photoReelFile) : data.photoReelUrl);
    setPhotoReelDuration(data.photoReelDuration);
    setCinematicLayout(data.cinematicLayout);
    setSplitDirection(data.splitDirection);
    setSplitPosition(data.splitPosition);
    setSplitBarSize(data.splitBarSize);
    setSplitBarColor(data.splitBarColor);
    setBrollPlacement(data.brollPlacement);
    setSelectedElement(null);
    setTimelineSelection(null);
    setContextMenu(null);
    setCurrentTime(0);
    activeMainOrderIndexRef.current = 0;
  }

  function sceneName(mode: TemplateMode, position: number) {
    return `Cena ${position} · ${TEMPLATE_LABELS[mode]}`;
  }

  function linkNewScene(mode: TemplateMode) {
    const currentData = captureSceneData();
    const firstSceneId = crypto.randomUUID();
    const newSceneId = crypto.randomUUID();
    setScenes((prev) => {
      const base = prev.length
        ? prev.map((scene) => (scene.id === activeSceneId ? { ...scene, data: currentData } : scene))
        : [{ id: firstSceneId, name: sceneName(currentData.mode, 1), data: currentData }];
      return [...base, { id: newSceneId, name: sceneName(mode, base.length + 1), data: currentData }];
    });
    setActiveSceneId(newSceneId);
    activateTemplateMode(mode);
    setToast(`Cena vinculada: ${TEMPLATE_LABELS[mode]} · edite e adicione o vídeo desta cena`);
  }

  function switchToScene(id: string) {
    if (id === activeSceneId) return;
    const target = scenes.find((scene) => scene.id === id);
    if (!target) return;
    const currentData = captureSceneData();
    setScenes((prev) => prev.map((scene) => (scene.id === activeSceneId ? { ...scene, data: currentData } : scene)));
    applySceneData(target.data);
    setActiveSceneId(id);
  }

  function removeScene(id: string) {
    const index = scenes.findIndex((scene) => scene.id === id);
    if (index < 0) return;
    const remaining = scenes.filter((scene) => scene.id !== id);
    if (remaining.length <= 1) {
      // Back to a single-scene project (no scenes layer).
      setScenes([]);
      setActiveSceneId(null);
      if (id === activeSceneId && remaining[0]) applySceneData(remaining[0].data);
      setToast("Cena removida");
      return;
    }
    if (id === activeSceneId) {
      const fallback = remaining[Math.max(0, index - 1)] || remaining[0];
      applySceneData(fallback.data);
      setActiveSceneId(fallback.id);
    }
    setScenes(remaining.map((scene, position) => ({ ...scene, name: scene.name.replace(/^Cena \d+/, `Cena ${position + 1}`) })));
    setToast("Cena removida");
  }

  function moveScene(id: string, direction: -1 | 1) {
    setScenes((prev) => {
      const index = prev.findIndex((scene) => scene.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((scene, position) => ({ ...scene, name: scene.name.replace(/^Cena \d+/, `Cena ${position + 1}`) }));
    });
  }

  function addCinematicText() {
    addExtraText();
  }

  function addCinematicImage(file?: File) {
    if (!file) return;
    const emptyIndex = products.findIndex((product) => !product.url);
    if (emptyIndex < 0) return setToast("O modelo atual comporta até 3 imagens independentes");
    chooseProduct(emptyIndex, file);
    setSelectedElement(`product-${emptyIndex}`);
    setToast("Imagem independente adicionada");
  }

  function speechAlignedStart(name: string, clipIndex: number) {
    const normalizedWords = name.toLocaleLowerCase("pt-BR").replace(/\.[^.]+$/, "").split(/[^a-záàâãéèêíïóôõöúçñ]+/).filter((word) => word.length > 3);
    const semanticMatch = transcriptChunks
      .map((chunk) => ({ chunk, score: normalizedWords.filter((word) => chunk.text.toLocaleLowerCase("pt-BR").includes(word)).length }))
      .sort((a, b) => b.score - a.score)[0];
    if (semanticMatch?.score) return semanticMatch.chunk.timestamp[0];
    if (transcriptChunks.length) {
      const speechPoint = transcriptChunks[Math.min(transcriptChunks.length - 1, Math.round((clipIndex + 1) * transcriptChunks.length / (clipIndex + 2)))];
      return speechPoint.timestamp[0];
    }
    return videoDuration ? Math.min(Math.max(0, videoDuration - 3.5), videoDuration * (clipIndex + 1) / (clipIndex + 2)) : clipIndex * 4;
  }

  async function bestVisualSegment(file: File) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("O vídeo complementar não pôde ser lido."));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const clipDuration = Math.min(3.5, Math.max(1, duration));
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 45;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const samples = Math.max(2, Math.min(18, Math.floor(duration)));
    let previous: Uint8ClampedArray | null = null;
    let bestTime = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < samples; index++) {
      const time = duration <= clipDuration ? 0 : .2 + index * Math.max(.1, duration - .5) / Math.max(1, samples - 1);
      const targetTime = Math.min(Math.max(0, duration - .15), time);
      await new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - targetTime) < .01) return resolve();
        video.onseeked = () => resolve();
        video.currentTime = targetTime;
      });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let luminance = 0;
      let movement = 0;
      for (let pixel = 0; pixel < pixels.length; pixel += 16) {
        const light = pixels[pixel] * .2126 + pixels[pixel + 1] * .7152 + pixels[pixel + 2] * .0722;
        luminance += light;
        if (previous) movement += Math.abs(pixels[pixel] - previous[pixel]) + Math.abs(pixels[pixel + 1] - previous[pixel + 1]) + Math.abs(pixels[pixel + 2] - previous[pixel + 2]);
      }
      const count = pixels.length / 16;
      const averageLight = luminance / count;
      const exposurePenalty = averageLight < 32 ? (32 - averageLight) * 2 : averageLight > 232 ? (averageLight - 232) * 2 : 0;
      const score = (previous ? movement / count : 0) - exposurePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestTime = Math.max(0, Math.min(Math.max(0, duration - clipDuration), time - clipDuration * .35));
      }
      previous = new Uint8ClampedArray(pixels);
    }
    URL.revokeObjectURL(url);
    return { sourceStart: bestTime, sourceDuration: duration, duration: clipDuration };
  }

  async function addBrollFile(file?: File, sourceUrl?: string) {
    if (!file || !file.type.startsWith("video/")) {
      setToast("Escolha um arquivo de vídeo válido");
      return;
    }
    setBrollStatus("analyzing");
    try {
      const segment = await bestVisualSegment(file);
      const timelineStart = speechAlignedStart(file.name, brollClips.length);
      const clip: BrollClip = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        file,
        url: URL.createObjectURL(file),
        sourceUrl,
        sourceStart: segment.sourceStart,
        sourceDuration: segment.sourceDuration,
        duration: segment.duration,
        timelineStart: Math.max(0, Math.min(Math.max(0, videoDuration - segment.duration), timelineStart)),
        sfx: "whoosh",
        focusX: 50,
        focusY: 50,
        layer: Math.min(5, brollClips.length),
      };
      setBrollClips((current) => [...current, clip]);
      setTemplateMode("cinematic");
      setActivePanel("broll");
      setToast(`Melhor trecho de ${clip.name} adicionado`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível analisar esse vídeo");
    } finally {
      setBrollStatus("idle");
      if (brollInputRef.current) brollInputRef.current.value = "";
    }
  }

  async function addMergeVideos(files: FileList | null) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("video/")).slice(0, 8);
    if (!selected.length || !videoFile) {
      setToast(videoFile ? "Escolha pelo menos um vídeo válido" : "Abra primeiro um vídeo da Fábrica");
      return;
    }
    setBrollStatus("analyzing");
    try {
      const segments = await Promise.all(selected.map(async (file, index) => {
        const segment = await bestVisualSegment(file);
        const usableDuration = Math.max(0, videoDuration - segment.duration);
        return {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ""),
          file,
          url: URL.createObjectURL(file),
          sourceStart: segment.sourceStart,
          sourceDuration: segment.sourceDuration,
          duration: segment.duration,
          timelineStart: selected.length === 1 ? usableDuration / 2 : usableDuration * (index + 1) / (selected.length + 1),
          sfx: "whoosh" as SoundEffectId,
          focusX: 50,
          focusY: 50,
          layer: Math.min(5, index),
        };
      }));
      setBrollClips((current) => [...current, ...segments]);
      setTemplateMode("cinematic");
      setCinematicLayout("replace");
      setToast(`${segments.length} vídeo${segments.length > 1 ? "s" : ""} mesclado${segments.length > 1 ? "s" : ""} automaticamente`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível mesclar os vídeos");
    } finally {
      setBrollStatus("idle");
      if (mergeInputRef.current) mergeInputRef.current.value = "";
    }
  }

  async function readVideoFileDuration(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const video = await prepareFactoryVideo(url);
      return Number.isFinite(video.duration) ? video.duration : 0;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderAppendedMain(files: File[]) {
    const urls = files.map((file) => URL.createObjectURL(file));
    const videos = await Promise.all(urls.map(prepareFactoryVideo));
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a sequência");
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioContextClass();
    const destination = audioContext.createMediaStreamDestination();
    videos.forEach((video) => audioContext.createMediaElementSource(video).connect(destination));
    await audioContext.resume();
    const stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const completed = new Promise<Blob>((resolve, reject) => { recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType })); recorder.onerror = () => reject(new Error("Falha ao unir os vídeos")); });
    recorder.start(500);
    for (const video of videos) {
      video.currentTime = 0;
      await video.play();
      await new Promise<void>((resolve) => {
        const frame = () => {
          context.fillStyle = "#090a0d";
          context.fillRect(0, 0, canvas.width, canvas.height);
          drawCover(context, video, canvas.width, canvas.height);
          if (video.ended || video.currentTime >= video.duration - .025) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      video.pause();
    }
    recorder.stop();
    const blob = await completed;
    videos.forEach((video) => { video.pause(); video.removeAttribute("src"); });
    urls.forEach(URL.revokeObjectURL);
    await audioContext.close();
    stream.getTracks().forEach((track) => track.stop());
    return blob;
  }

  async function addAdditionalVideos(files: FileList | null) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("video/")).slice(0, 8);
    if (!selected.length || !videoFile) return setToast(videoFile ? "Escolha pelo menos um vídeo válido" : "Adicione primeiro o vídeo principal");
    if (additionalVideoMode === "overlay") {
      setBrollStatus("analyzing");
      try {
        const clips = await Promise.all(selected.map(async (file, index) => {
          const segment = await bestVisualSegment(file);
          return {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.[^.]+$/, ""),
            file,
            url: URL.createObjectURL(file),
            sourceStart: segment.sourceStart,
            sourceDuration: segment.sourceDuration,
            duration: segment.duration,
            timelineStart: clamp(currentTime + index * .4, 0, Math.max(0, videoDuration - segment.duration)),
            sfx: "whoosh" as SoundEffectId,
            focusX: 50,
            focusY: 50,
            layer: Math.min(9, overlayVideoClips.length + index),
            placement: "overlay" as const,
            overlayX: index % 2 === 0 ? 54 : 6,
            overlayY: 8 + index % 3 * 7,
            overlayWidth: 40,
          };
        }));
        setBrollClips((current) => [...current, ...clips]);
        setToast(`${clips.length} vídeo${clips.length > 1 ? "s" : ""} adicionado${clips.length > 1 ? "s" : ""} como sobreposição`);
      } finally { setBrollStatus("idle"); if (mergeInputRef.current) mergeInputRef.current.value = ""; }
      return;
    }
    setBrollStatus("analyzing");
    try {
      const durations = await Promise.all(selected.map(readVideoFileDuration));
      const timelineBase = videoDuration;
      let cursor = timelineBase;
      const boundaries: number[] = [];
      const clips = selected.map((file, index) => {
        const duration = Math.max(.1, durations[index]);
        boundaries.push(cursor);
        const clip: BrollClip = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ""), file, url: URL.createObjectURL(file), sourceStart: 0, sourceDuration: duration, duration, timelineStart: cursor, sfx: "whoosh", focusX: 50, focusY: 50, layer: 0, placement: "sequence" };
        cursor += duration;
        return clip;
      });
      const blob = await renderAppendedMain([videoFile, ...selected]);
      const file = new File([blob], `${videoFile.name.replace(/\.[^.]+$/, "")}-sequencia.webm`, { type: blob.type || "video/webm" });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setVideoDuration(cursor);
      knownVideoDurationRef.current = cursor;
      setVideoSplits((current) => [...current, ...boundaries].filter((time, index, list) => time > .05 && time < cursor - .05 && list.findIndex((item) => Math.abs(item - time) < .05) === index).sort((first, second) => first - second));
      setMainSegmentOrder([]);
      setBrollClips((current) => [...current, ...clips]);
      void buildWaveform(file).then((waveform) => setWaveformSamples(waveform.samples));
      setToast(`${clips.length} vídeo${clips.length > 1 ? "s" : ""} conectado${clips.length > 1 ? "s" : ""} à sequência principal`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível unir os vídeos");
    } finally { setBrollStatus("idle"); if (mergeInputRef.current) mergeInputRef.current.value = ""; }
  }

  async function importBrollFromLink() {
    if (!brollLink.trim()) return;
    let url: URL;
    try {
      url = new URL(brollLink.trim());
    } catch {
      setToast("Cole um link HTTPS válido");
      return;
    }
    const protectedPlatform = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|pinterest\.[a-z.]+)$/i.test(url.hostname);
    if (protectedPlatform) {
      setBrollReference(url.toString());
      setToast("Referência salva. Envie o arquivo original autorizado para editar");
      return;
    }
    setBrollStatus("importing");
    try {
      const response = await fetch("/api/import-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.toString() }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Não foi possível importar esse link.");
      }
      const blob = await response.blob();
      const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
      const file = new File([blob], `video-cinematografico.${extension}`, { type: blob.type });
      if (videoLinkTarget === "main") {
        chooseVideo(file);
        setTemplateMode("cinematic");
        setBrollStatus("idle");
        setToast("Vídeo importado como principal");
      } else {
        await addBrollFile(file, url.toString());
      }
      setBrollLink("");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível importar esse vídeo");
      setBrollStatus("idle");
    }
  }

  function updateBroll(id: string, patch: Partial<BrollClip>) {
    setBrollClips((current) => current.map((clip) => clip.id === id ? { ...clip, ...patch } : clip));
  }

  function removeBroll(id: string) {
    setBrollClips((current) => {
      const removed = current.find((clip) => clip.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((clip) => clip.id !== id);
    });
  }

  function createSoundEffectBuffer(context: AudioContext, effect: SoundEffectId) {
    const durations: Record<SoundEffectId, number> = { whoosh: .65, impact: .7, riser: .9, pop: .22, shutter: .16, sparkle: .8 };
    const duration = durations[effect];
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 9137;
    for (let index = 0; index < data.length; index++) {
      const time = index / context.sampleRate;
      const progress = time / duration;
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      let sample = 0;
      if (effect === "whoosh") sample = noise * Math.sin(Math.PI * progress) * .32 + Math.sin(2 * Math.PI * (180 + 900 * progress) * time) * .06;
      if (effect === "impact") sample = Math.sin(2 * Math.PI * (92 - 48 * progress) * time) * Math.exp(-5 * progress) * .78 + noise * Math.exp(-18 * progress) * .25;
      if (effect === "riser") sample = Math.sin(2 * Math.PI * (130 + 1100 * progress * progress) * time) * progress * .22 + noise * progress * progress * .12;
      if (effect === "pop") sample = Math.sin(2 * Math.PI * (520 - 240 * progress) * time) * Math.exp(-9 * progress) * .58;
      if (effect === "shutter") sample = noise * Math.exp(-25 * progress) * .42 + Math.sin(2 * Math.PI * 170 * time) * Math.exp(-14 * progress) * .18;
      if (effect === "sparkle") sample = (Math.sin(2 * Math.PI * 880 * time) + .6 * Math.sin(2 * Math.PI * 1320 * time) + .35 * Math.sin(2 * Math.PI * 1760 * time)) * Math.exp(-4 * progress) * .17;
      data[index] = Math.max(-1, Math.min(1, sample));
    }
    return buffer;
  }

  async function previewSoundEffect(effect: SoundEffectId) {
    const context = new AudioContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = createSoundEffectBuffer(context, effect);
    gain.gain.value = .8;
    source.connect(gain).connect(context.destination);
    source.onended = () => context.close();
    source.start();
  }

  async function autoFrameMainFace() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return setToast("Carregue o vídeo principal antes de detectar o rosto");
    setFocusStatus("face");
    try {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/models/blaze_face_short_range.tflite" },
        runningMode: "IMAGE",
        minDetectionConfidence: .5,
      });
      const result = detector.detect(video);
      const largestFace = result.detections
        .filter((detection) => detection.boundingBox)
        .sort((first, second) => (second.boundingBox!.width * second.boundingBox!.height) - (first.boundingBox!.width * first.boundingBox!.height))[0];
      detector.close();
      if (!largestFace?.boundingBox) throw new Error("Nenhum rosto foi encontrado neste quadro. Avance o vídeo e tente novamente.");
      const box = largestFace.boundingBox;
      const detectedFocus = {
        x: Math.max(0, Math.min(100, (box.originX + box.width / 2) / video.videoWidth * 100)),
        y: Math.max(0, Math.min(100, (box.originY + box.height * .44) / video.videoHeight * 100)),
      };
      setMainVideoFocus(detectedFocus);
      setMainCrop((current) => ({ ...current, ...detectedFocus }));
      setToast("Rosto centralizado automaticamente");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível detectar o rosto");
    } finally {
      setFocusStatus("idle");
    }
  }

  async function autoFrameComplementary() {
    const clip = activeBroll || brollClips[0];
    if (!clip) return setToast("Adicione uma cena complementar primeiro");
    setFocusStatus("scene");
    const video = document.createElement("video");
    video.src = clip.url;
    video.muted = true;
    video.playsInline = true;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Não foi possível abrir a cena complementar"));
      });
      const targetTime = Math.min(Math.max(0, clip.sourceDuration - .1), clip.sourceStart + clip.duration / 2);
      await new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - targetTime) < .01) return resolve();
        video.onseeked = () => resolve();
        video.currentTime = targetTime;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 68;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      let weightedX = 0;
      let weightedY = 0;
      for (let y = 2; y < canvas.height - 2; y += 2) {
        for (let x = 2; x < canvas.width - 2; x += 2) {
          const offset = (y * canvas.width + x) * 4;
          const left = (y * canvas.width + x - 2) * 4;
          const top = ((y - 2) * canvas.width + x) * 4;
          const edge = Math.abs(pixels[offset] - pixels[left]) + Math.abs(pixels[offset + 1] - pixels[left + 1]) + Math.abs(pixels[offset + 2] - pixels[left + 2]) + Math.abs(pixels[offset] - pixels[top]) + Math.abs(pixels[offset + 1] - pixels[top + 1]) + Math.abs(pixels[offset + 2] - pixels[top + 2]);
          const saturation = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) - Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
          const centerBias = 1 - Math.min(.55, Math.hypot(x / canvas.width - .5, y / canvas.height - .5));
          const weight = Math.max(1, edge + saturation * .7) * centerBias;
          total += weight;
          weightedX += x * weight;
          weightedY += y * weight;
        }
      }
      updateBroll(clip.id, { focusX: weightedX / total / canvas.width * 100, focusY: weightedY / total / canvas.height * 100 });
      setToast("Ponto de interesse da cena centralizado");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível ajustar a cena");
    } finally {
      setFocusStatus("idle");
    }
  }

  function beginFocusDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!focusEditMode) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    const position = splitDirection === "horizontal"
      ? (event.clientY - bounds.top) / bounds.height * 100
      : (event.clientX - bounds.left) / bounds.width * 100;
    const isFirst = position < splitPosition;
    const target: "main" | "broll" = activeBroll && (cinematicLayout === "replace" || (brollPlacement === "first" ? isFirst : !isFirst)) ? "broll" : "main";
    const focus = target === "broll" && activeBroll ? { x: activeBroll.focusX, y: activeBroll.focusY } : mainVideoFocus;
    event.currentTarget.setPointerCapture(event.pointerId);
    focusDragRef.current = { pointerId: event.pointerId, target, startX: event.clientX, startY: event.clientY, focusX: focus.x, focusY: focus.y, width: bounds.width, height: bounds.height, clipId: target === "broll" ? activeBroll?.id : undefined };
  }

  function moveFocusDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = focusDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const next = {
      x: Math.max(0, Math.min(100, drag.focusX - (event.clientX - drag.startX) / drag.width * 100)),
      y: Math.max(0, Math.min(100, drag.focusY - (event.clientY - drag.startY) / drag.height * 100)),
    };
    if (drag.target === "main") {
      setMainVideoFocus(next);
      setMainCrop((current) => ({ ...current, ...next }));
    }
    else if (drag.clipId) updateBroll(drag.clipId, { focusX: next.x, focusY: next.y });
  }

  function endFocusDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (focusDragRef.current?.pointerId !== event.pointerId) return;
    focusDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function previewTextStyle(style: TextStyle): React.CSSProperties {
    return {
      fontFamily: `"${style.fontFamily}", sans-serif`,
      fontSize: `${style.fontSize / 10.8}cqw`,
      fontWeight: style.fontWeight,
      color: style.color,
      WebkitTextStroke: `${style.strokeWidth / 3.4}px ${style.strokeColor}`,
      paintOrder: "stroke fill",
      textShadow: style.shadow ? "0 3px 10px rgba(0,0,0,.55)" : "none",
      fontStyle: style.italic ? "italic" : "normal",
      textDecoration: style.underline ? "underline" : "none",
      textTransform: style.uppercase ? "uppercase" : "none",
      textAlign: style.align,
      letterSpacing: `${style.letterSpacing / 3.4}px`,
      background: style.background,
      borderRadius: style.background === "transparent" ? 0 : 6,
      padding: style.background === "transparent" ? 0 : "4px 8px",
    };
  }

  function brollPreviewStyle(): React.CSSProperties {
    if (activeBroll?.placement === "overlay") {
      return {
        inset: "auto",
        left: `${activeBroll.overlayX ?? 54}%`,
        top: `${activeBroll.overlayY ?? 8}%`,
        width: `${activeBroll.overlayWidth ?? 40}%`,
        height: "auto",
        aspectRatio: "9 / 16",
        borderRadius: "2cqw",
        border: "1px solid rgba(255,255,255,.8)",
        boxShadow: "0 2cqw 5cqw rgba(0,0,0,.34)",
      };
    }
    if (cinematicLayout === "replace") return {};
    if (cinematicLayout === "split-bar") {
      if (splitDirection === "horizontal") return brollPlacement === "first"
        ? { top: 0, bottom: "auto", height: `${splitPosition}%` }
        : { top: `${splitPosition}%`, bottom: "auto", height: `${100 - splitPosition}%` };
      return brollPlacement === "first"
        ? { left: 0, right: "auto", width: `${splitPosition}%` }
        : { left: `${splitPosition}%`, right: "auto", width: `${100 - splitPosition}%` };
    }
    const start = Math.max(0, splitPosition - 12);
    const end = Math.min(100, splitPosition + 12);
    const mask = splitDirection === "horizontal"
      ? brollPlacement === "first" ? `linear-gradient(to bottom, black ${start}%, transparent ${end}%)` : `linear-gradient(to bottom, transparent ${start}%, black ${end}%)`
      : brollPlacement === "first" ? `linear-gradient(to right, black ${start}%, transparent ${end}%)` : `linear-gradient(to right, transparent ${start}%, black ${end}%)`;
    return { WebkitMaskImage: mask, maskImage: mask };
  }

  function mainPreviewStyle(): React.CSSProperties {
    if (templateMode === "react") return {
      inset: "auto",
      left: `${reactLayout.x}%`,
      top: `${reactLayout.y}%`,
      width: `${reactLayout.width}%`,
      height: `${reactLayout.height}%`,
      borderRadius: `${reactLayout.radius}cqw`,
    };
    if (cinematicLayout !== "split-bar" || !activeBroll) return {};
    if (splitDirection === "horizontal") return brollPlacement === "first"
      ? { top: `${splitPosition}%`, bottom: "auto", height: `${100 - splitPosition}%` }
      : { top: 0, bottom: "auto", height: `${splitPosition}%` };
    return brollPlacement === "first"
      ? { left: `${splitPosition}%`, right: "auto", width: `${100 - splitPosition}%` }
      : { left: 0, right: "auto", width: `${splitPosition}%` };
  }

  function scaledTextStyle(target: TextTarget, id: CanvasElementId) {
    const layout = canvasLayouts[id] || { x: 50, y: 50, width: 72 };
    const baseline = DEFAULT_CANVAS_LAYOUTS[id]?.width || layout.width;
    const scale = Math.max(.35, layout.width / baseline);
    const layerStyle = id.startsWith("extra-text-")
      ? extraTextLayers.find((layer) => layer.id === id.slice("extra-text-".length))?.style
      : undefined;
    const style = layerStyle || settings.textStyles[target] || DEFAULT_TEXT_STYLES.extra;
    return {
      ...style,
      fontSize: style.fontSize * scale,
      strokeWidth: style.strokeWidth * scale,
    };
  }

  function updateProduct(index: number, patch: Partial<Product>) {
    setProducts((current) => current.map((product, itemIndex) =>
      itemIndex === index ? { ...product, ...patch } : product,
    ));
  }

  async function buildWaveform(file: File) {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      // High resolution so that zooming the timeline reveals real detail
      // instead of stretching a handful of coarse bars.
      const bins = Math.min(8000, Math.max(1200, Math.round(buffer.duration * 90)));
      const samplesPerBin = Math.max(1, Math.floor(buffer.length / bins));
      const stride = Math.max(1, Math.floor(samplesPerBin / 64));
      const samples = Array.from({ length: bins }, (_, index) => {
        const start = index * samplesPerBin;
        const end = Math.min(buffer.length, start + samplesPerBin);
        let peak = 0;
        for (const channel of channels) {
          for (let sample = start; sample < end; sample += stride) peak = Math.max(peak, Math.abs(channel[sample] || 0));
        }
        return peak;
      });
      const loudReference = [...samples].sort((a, b) => a - b)[Math.max(0, Math.floor(samples.length * .96))] || 1;
      await context.close();
      return { duration: buffer.duration, samples: samples.map((sample) => clamp(sample / Math.max(.015, loudReference), .025, 1)) };
    } catch {
      return { duration: 0, samples: [] as number[] };
    }
  }

  async function chooseImportedAudio(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setToast("Escolha um arquivo de áudio (MP3, WAV, M4A…)");
      return;
    }
    const id = crypto.randomUUID();
    const track: ImportedAudioTrack = { id, name: file.name, file, url: URL.createObjectURL(file), samples: [], duration: 0, volume: 1, offset: 0 };
    setImportedAudios((current) => [...current, track]);
    setTimelineCollapsed(false);
    setToast(`Áudio "${file.name}" importado`);
    const waveform = await buildWaveform(file);
    setImportedAudios((current) => current.map((item) => item.id === id ? { ...item, samples: waveform.samples, duration: waveform.duration } : item));
  }

  function updateImportedAudio(id: string, patch: Partial<ImportedAudioTrack>) {
    setImportedAudios((current) => current.map((track) => track.id === id ? { ...track, ...patch } : track));
  }

  function removeImportedAudio(id: string) {
    const audio = importedAudioElsRef.current[id];
    if (audio) audio.pause();
    delete importedAudioElsRef.current[id];
    delete importedAudioBuffersRef.current[id];
    setImportedAudios((current) => {
      const track = current.find((item) => item.id === id);
      if (track) URL.revokeObjectURL(track.url);
      return current.filter((item) => item.id !== id);
    });
    setTimelineSelection((current) => (current?.kind === "imported-audio" && current.id === id ? null : current));
  }

  function syncImportedAudio(videoTime: number, options?: { force?: boolean }) {
    importedAudios.forEach((track) => {
      const audio = importedAudioElsRef.current[track.id];
      if (!audio) return;
      const target = videoTime - track.offset;
      if (target < -.05 || target > track.duration + .05) {
        if (!audio.paused) audio.pause();
        return;
      }
      const clampedTarget = clamp(target, 0, Math.max(0, track.duration - .01));
      if (options?.force || Math.abs(audio.currentTime - clampedTarget) > .28) audio.currentTime = clampedTarget;
      audio.playbackRate = playbackSpeed;
      audio.volume = clamp(track.volume, 0, 1);
      if (isPlaying && audio.paused) audio.play().catch(() => undefined);
      else if (!isPlaying && !audio.paused) audio.pause();
    });
  }

  function beginImportedAudioDrag(event: React.PointerEvent<HTMLElement>, id: string) {
    const track = event.currentTarget.closest(".timeline-track");
    const audioTrack = importedAudios.find((item) => item.id === id);
    if (!(track instanceof HTMLElement) || !audioTrack) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTimelineSelection({ kind: "imported-audio", id });
    importedAudioDragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, width: track.getBoundingClientRect().width, initialOffset: audioTrack.offset };
  }

  function moveImportedAudioDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = importedAudioDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !videoDuration) return;
    event.preventDefault();
    const deltaTime = ((event.clientX - drag.startX) / Math.max(1, drag.width)) * videoDuration;
    updateImportedAudio(drag.id, { offset: clamp(drag.initialOffset + deltaTime, 0, Math.max(.2, videoDuration)) });
  }

  function endImportedAudioDrag(event: React.PointerEvent<HTMLElement>) {
    if (importedAudioDragRef.current?.pointerId !== event.pointerId) return;
    importedAudioDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    syncImportedAudio(videoRef.current?.currentTime ?? currentTime, { force: true });
  }

  function chooseWatermarkPhoto(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast("Escolha uma imagem para a foto da marca");
      return;
    }
    if (watermarkPhotoUrl) URL.revokeObjectURL(watermarkPhotoUrl);
    setWatermarkPhotoUrl(URL.createObjectURL(file));
  }

  function removeWatermarkPhoto() {
    if (watermarkPhotoUrl) URL.revokeObjectURL(watermarkPhotoUrl);
    setWatermarkPhotoUrl("");
  }

  function toggleWatermark() {
    setWatermarkEnabled((current) => {
      const next = !current;
      if (next) {
        setSelectedElement("watermark");
        setToast("Marca ativada · arraste e ajuste no vídeo");
      } else {
        setSelectedElement((element) => (element === "watermark" ? null : element));
      }
      return next;
    });
  }

  function beginWatermarkInteraction(event: React.PointerEvent<HTMLElement>, type: "drag" | "resize") {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = stage.getBoundingClientRect();
    watermarkInteractionRef.current = {
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout: { ...watermarkLayout },
      stageWidth: bounds.width,
      stageHeight: bounds.height,
    };
    setSelectedElement("watermark");
  }

  function moveWatermarkInteraction(event: React.PointerEvent<HTMLElement>) {
    const interaction = watermarkInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - interaction.startX) / interaction.stageWidth * 100;
    const deltaY = (event.clientY - interaction.startY) / interaction.stageHeight * 100;
    const layout = interaction.layout;
    setWatermarkLayout(interaction.type === "drag"
      ? { ...layout, x: clamp(layout.x + deltaX, 3, 97), y: clamp(layout.y + deltaY, 3, 97) }
      : { ...layout, width: clamp(layout.width + deltaX * 2, 16, 96) });
  }

  function endWatermarkInteraction(event: React.PointerEvent<HTMLElement>) {
    if (watermarkInteractionRef.current?.pointerId !== event.pointerId) return;
    watermarkInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function selectTimelineTarget(target: ContextTarget) {
    if (target.kind === "watermark") {
      setSelectedElement("watermark");
      return;
    }
    setTimelineSelection(target);
    if (target.kind === "scene") setSelectedRankingScene(target.index);
    if (target.kind === "removed") setSelectedCut(target.index);
  }

  function openContextMenu(event: React.MouseEvent, target: ContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    selectTimelineTarget(target);
    setContextMenu({ x: event.clientX, y: event.clientY, target });
  }

  function deleteTimelineTarget(target: ContextTarget) {
    switch (target.kind) {
      case "main":
        if (orderedVideoSegments.length <= 1) { setToast("O vídeo principal não pode ser removido"); break; }
        removeMainSegment(target.index);
        break;
      case "ranking": removeRankingItem(target.index); break;
      case "scene":
        if (rankingScenes.length <= 1) { setToast("Mantenha ao menos um quadro"); break; }
        removeRankingScene(target.index);
        break;
      case "broll": removeBroll(target.id); break;
      case "audio": pushEditorHistory(); setAudioExtracted(false); break;
      case "imported-audio": removeImportedAudio(target.id); break;
      case "removed": restoreCut(target.index); break;
      case "watermark": setWatermarkEnabled(false); break;
      case "factory": setToast("Os clipes da Fábrica são ajustados pelas alças, não removidos aqui"); break;
    }
    setTimelineSelection((current) => (current === target ? null : current));
    setContextMenu(null);
  }

  function contextTargetLabel(target: ContextTarget): string {
    switch (target.kind) {
      case "main": return orderedVideoSegments.length > 1 ? `Vídeo · trecho ${target.index + 1}` : "Vídeo principal";
      case "ranking": return products[target.index]?.name || `Item ${target.index + 1}`;
      case "scene": return rankingScenes[target.index]?.title || `Quadro ${target.index + 1}`;
      case "broll": return brollClips.find((clip) => clip.id === target.id)?.name || "Sobreposição";
      case "audio": return "Áudio extraído";
      case "imported-audio": return importedAudios.find((track) => track.id === target.id)?.name || "Áudio importado";
      case "removed": return "Trecho removido";
      case "watermark": return "Minha marca";
      case "factory": return "Clipe da Fábrica";
    }
  }

  function contextMenuActions(target: ContextTarget): Array<{ label: string; onClick: () => void; danger?: boolean }> {
    const actions: Array<{ label: string; onClick: () => void; danger?: boolean }> = [];
    const close = () => setContextMenu(null);
    if (target.kind === "main") {
      const segment = orderedVideoSegments[target.index];
      if (segment) actions.push({ label: "Ir ao início", onClick: () => { seekVideo(segment.start); close(); } });
      actions.push({ label: "◨ Dividir no cursor", onClick: () => { splitMainVideo(); close(); } });
    }
    if (target.kind === "ranking") {
      actions.push({ label: "Ir ao início", onClick: () => { seekVideo(rankingStart(target.index)); close(); } });
      actions.push({ label: "Duplicar", onClick: () => { duplicateRankingItem(target.index); close(); } });
    }
    if (target.kind === "scene") {
      actions.push({ label: "Editar quadro", onClick: () => { setSelectedRankingScene(target.index); setActivePanel("edit"); seekVideo(Math.min(rankingSceneStarts[target.index] || 0, videoDuration)); close(); } });
    }
    if (target.kind === "broll") {
      const clip = brollClips.find((item) => item.id === target.id);
      if (clip) actions.push({ label: "Ir ao início", onClick: () => { seekVideo(clip.timelineStart); close(); } });
    }
    if (target.kind === "imported-audio") {
      actions.push({ label: "Começar no cursor", onClick: () => { updateImportedAudio(target.id, { offset: clamp(currentTime, 0, Math.max(.2, videoDuration)) }); close(); } });
    }
    if (target.kind === "audio") {
      actions.push({ label: settings.removeAudio ? "Ativar áudio" : "Silenciar áudio", onClick: () => { pushEditorHistory(); setSettings((current) => ({ ...current, removeAudio: !current.removeAudio })); close(); } });
    }
    if (target.kind === "removed") {
      actions.push({ label: "▶ Ouvir removido", onClick: () => { previewRemovedCut(target.index); close(); } });
    }
    if (target.kind === "watermark") {
      actions.push({ label: "Reposicionar", onClick: () => { setWatermarkLayout(DEFAULT_WATERMARK_LAYOUT); close(); } });
    }
    const removeLabel = target.kind === "removed" ? "↩ Restaurar trecho" : target.kind === "audio" ? "Excluir faixa de áudio" : "Remover";
    actions.push({ label: removeLabel, danger: true, onClick: () => deleteTimelineTarget(target) });
    return actions;
  }

  function chooseVideo(file?: File, metadata?: { duration?: number; removedRanges?: FactoryRemovedRange[]; structureRanges?: FactoryStructureRange[] }) {
    if (!file || !file.type.startsWith("video/")) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const knownDuration = metadata?.duration && metadata.duration > 0 ? metadata.duration : 0;
    knownVideoDurationRef.current = knownDuration;
    setVideoFile(file);
    setVideoUrl(fileUrl(file));
    if (templateMode === "react") {
      setReactRemoveBackground(true);
      setReactSegmentationStatus("loading");
    }
    setSilentRanges([]);
    setFactoryRemovedRanges(metadata?.removedRanges || []);
    setFactoryStructureRanges(metadata?.structureRanges || []);
    if (!metadata?.structureRanges?.length) {
      setActiveFactorySequence(null);
      setActiveFactoryProjectId(null);
    }
    setWaveformSamples([]);
    setCutHistory([]);
    setSelectedCut(null);
    setTimelineSelection(null);
    setVideoSplits([]);
    setMainSegmentOrder([0]);
    setMainCrop({ zoom: 1, x: 50, y: 50 });
    setMainVideoFocus({ x: 50, y: 50 });
    setPlaybackSpeed(1);
    setAudioExtracted(false);
    setTimelineMarkers([]);
    setEditorHistory([]);
    setReviewingCut(null);
    setVideoDuration(knownDuration);
    setCurrentTime(0);
    setAnalysisStatus("idle");
    setTranscriptionStatus("idle");
    setTranscriptionProgress(0);
    setTranscriptionError("");
    setTranscriptText("");
    setTranscriptChunks([]);
    void buildWaveform(file).then((waveform) => {
      setWaveformSamples(waveform.samples);
      if (waveform.duration > 0) {
        knownVideoDurationRef.current = waveform.duration;
        setVideoDuration(waveform.duration);
      }
    });
    setToast("Vídeo principal carregado");
  }

  function chooseMainMedia(file?: File) {
    if (!file) return;
    if (file.type.startsWith("video/")) {
      if (photoReelUrl) URL.revokeObjectURL(photoReelUrl);
      setPhotoReelFile(undefined);
      setPhotoReelUrl(undefined);
      chooseVideo(file);
      return;
    }
    if (!file.type.startsWith("image/")) return setToast("Escolha um vídeo ou uma imagem válida");
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (photoReelUrl) URL.revokeObjectURL(photoReelUrl);
    setVideoFile(undefined);
    setVideoUrl(undefined);
    setPhotoReelFile(file);
    setPhotoReelUrl(URL.createObjectURL(file));
    setPhotoReelDuration(10);
    setPhotoReelProgress(0);
    setVideoDuration(10);
    setCurrentTime(0);
    setIsPlaying(false);
    setToast("Foto adicionada · escolha de 5 a 15 segundos para criar o Reels");
  }

  async function convertPhotoToReel() {
    if (!photoReelFile || photoReelStatus === "rendering") return;
    if (!("MediaRecorder" in window)) return setToast("Este navegador não consegue criar o Reels localmente");
    setPhotoReelStatus("rendering");
    setPhotoReelProgress(0);
    try {
      const bitmap = await createImageBitmap(photoReelFile);
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      const finished = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("Falha ao transformar a foto em vídeo"));
      });
      const startedAt = performance.now();
      let animationFrame = 0;
      const drawFrame = (timestamp: number) => {
        const elapsed = Math.min(photoReelDuration, (timestamp - startedAt) / 1000);
        const progress = elapsed / photoReelDuration;
        const baseScale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const scale = baseScale * (1 + progress * .045);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.fillStyle = "#111216";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2 - progress * canvas.height * .012, width, height);
        setPhotoReelProgress(Math.min(100, Math.round(progress * 100)));
        if (elapsed < photoReelDuration) animationFrame = requestAnimationFrame(drawFrame);
        else recorder.stop();
      };
      recorder.start(250);
      animationFrame = requestAnimationFrame(drawFrame);
      await finished;
      cancelAnimationFrame(animationFrame);
      bitmap.close();
      stream.getTracks().forEach((track) => track.stop());
      const reel = new File([new Blob(chunks, { type: mimeType })], `${photoReelFile.name.replace(/\.[^.]+$/, "")}-reels-${photoReelDuration}s.webm`, { type: mimeType });
      chooseVideo(reel, { duration: photoReelDuration });
      setToast(`Reels de ${photoReelDuration}s criado e aberto na timeline`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível transformar a foto em Reels");
    } finally {
      setPhotoReelStatus("idle");
      setPhotoReelProgress(0);
    }
  }

  function handleLoadedVideoMetadata(video: HTMLVideoElement) {
    const reportedDuration = Number.isFinite(video.duration) && video.duration > .01 ? video.duration : 0;
    const fallbackDuration = knownVideoDurationRef.current;
    setVideoDuration(reportedDuration || fallbackDuration);
    if (!reportedDuration && fallbackDuration > .01) {
      const restoreStart = () => {
        const discovered = Number.isFinite(video.duration) && video.duration > .01 ? video.duration : fallbackDuration;
        setVideoDuration(discovered);
        video.currentTime = 0;
      };
      video.addEventListener("seeked", restoreStart, { once: true });
      try { video.currentTime = Math.max(0, fallbackDuration - .01); } catch { /* mantém a duração calculada pelo áudio */ }
    }
  }

  async function removeProductBackground(file: File, mode: BackgroundRemovalMode) {
    if (mode === "white") {
      setBackgroundStage("Removendo somente o fundo branco");
      setBackgroundProgress(55);
      const result = await removeWhiteBackground(file);
      setBackgroundStage("Preservando cores e detalhes");
      setBackgroundProgress(94);
      return result;
    }
    try {
      setBackgroundStage("Preparando recorte inteligente");
      setBackgroundProgress(2);
      const { removeBackground } = await import("./lib/background-removal.mjs") as {
        removeBackground: typeof import("@imgly/background-removal").removeBackground;
      };
      const blob = await removeBackground(file, {
        publicPath: `${window.location.origin}/background-removal/`,
        device: "cpu",
        model: "isnet_fp16",
        output: { format: "image/png", quality: 1 },
        progress: (key, current, total) => {
          const download = total > 0 ? Math.round((current / total) * 72) : 0;
          setBackgroundStage(key.includes("model") ? "Carregando modelo local" : "Preparando recorte inteligente");
          setBackgroundProgress(Math.max(2, Math.min(74, download)));
        },
      });
      setBackgroundStage("Refinando bordas");
      setBackgroundProgress(92);
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-sem-fundo.png`, { type: "image/png" });
    } catch (error) {
      console.warn("Recorte inteligente indisponível; usando remoção por cor.", error);
      setBackgroundStage("Aplicando recorte alternativo");
      setBackgroundProgress(78);
      return removeWhiteBackground(file);
    }
  }

  async function chooseProduct(index: number, file?: File, mode: BackgroundRemovalMode = "white") {
    if (!file || !file.type.startsWith("image/")) return;
    setProcessingProduct(index);
    setBackgroundProgress(0);
    try {
      const backgroundFreeFile = await removeProductBackground(file, mode);
      const processedFile = templateMode === "timed-ranking"
        ? await (async () => {
            setBackgroundStage("Centralizando sem reduzir a resolução");
            setBackgroundProgress(96);
            return normalizeProductImage(backgroundFreeFile);
          })()
        : backgroundFreeFile;
      const previous = products[index]?.url;
      if (previous) URL.revokeObjectURL(previous);
      updateProduct(index, {
        file: processedFile,
        url: fileUrl(processedFile),
        name: file.name.replace(/\.[^.]+$/, ""),
      });
      setBackgroundProgress(100);
      setToast(templateMode === "timed-ranking"
        ? "Produto recortado, centralizado e padronizado em alta resolução"
        : mode === "white" ? "Fundo branco removido com preservação de detalhes" : "Recorte inteligente concluído");
    } catch {
      setToast("Não foi possível remover o fundo desta imagem");
    } finally {
      setProcessingProduct(null);
      window.setTimeout(() => {
        setBackgroundProgress(0);
        setBackgroundStage("");
      }, 500);
    }
  }

  async function harmonizeRankingProducts() {
    const candidates = products.slice(0, rankingSettings.count).map((product, index) => ({ product, index })).filter(({ product }) => product.file);
    if (!candidates.length) {
      setToast("Adicione imagens aos itens antes de harmonizar");
      return;
    }
    setHarmonizingProducts(true);
    try {
      for (const { product, index } of candidates) {
        const normalized = await normalizeProductImage(product.file!);
        if (product.url) URL.revokeObjectURL(product.url);
        updateProduct(index, { file: normalized, url: URL.createObjectURL(normalized) });
      }
      setToast(`${candidates.length} produtos alinhados no mesmo padrão visual`);
    } catch {
      setToast("Não foi possível harmonizar todas as imagens");
    } finally {
      setHarmonizingProducts(false);
    }
  }

  async function importProductFromLink() {
    const value = productLink.trim();
    if (!value) {
      setToast("Cole o link público da imagem");
      return;
    }
    setImportingLink(true);
    setProcessingProduct(linkProductIndex);
    setBackgroundStage("Baixando imagem do link");
    setBackgroundProgress(1);
    try {
      const response = await fetch("/api/import-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || "Não foi possível importar o link.");
      }
      const blob = await response.blob();
      const subtype = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const file = new File([blob], `produto-link.${subtype}`, { type: blob.type });
      setProcessingProduct(null);
      await chooseProduct(linkProductIndex, file, backgroundRemovalMode);
      setProductLink("");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível importar o link");
      setProcessingProduct(null);
      setBackgroundProgress(0);
      setBackgroundStage("");
    } finally {
      setImportingLink(false);
    }
  }

  function onVideoDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    chooseMainMedia(event.dataTransfer.files[0]);
  }

  async function saveTemplate() {
    const snapshot: SavedTemplate = {
      title: settings.title,
      category: settings.category,
      accent: settings.accent,
      removeAudio: settings.removeAudio,
      removeSilence: settings.removeSilence,
      thresholdDb: settings.thresholdDb,
      minimumSilence: settings.minimumSilence,
      padding: settings.padding,
      textStyles: settings.textStyles,
      products: products.map(({ name, label, file }) => ({ name, label, image: file })),
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      mode: templateMode,
      layouts: canvasLayouts,
      ranking: templateMode === "timed-ranking" ? {
        ...rankingSettings,
        itemTimes: [...rankingSettings.itemTimes],
        itemEndTimes: [...rankingSettings.itemEndTimes],
        itemLayers: [...rankingSettings.itemLayers],
        itemScales: [...rankingSettings.itemScales],
      } : undefined,
      rankingScenes: templateMode === "ranking" ? rankingScenes.map((scene) => ({ ...scene })) : undefined,
      extraTexts: extraTextLayers.map((layer) => ({ ...layer, style: { ...layer.style } })),
      routineHeadings: templateMode === "routine" ? { ...routineHeadings } : undefined,
      questionBox: templateMode === "question-box" ? { ...questionBox } : undefined,
    };
    try {
      await writeLocalTemplate(snapshot);
      setTemplates((current) => [snapshot, ...current].slice(0, 12));
      setToast("Modelo e produtos salvos neste computador");
    } catch {
      setToast("Não foi possível salvar o modelo neste navegador");
    }
  }

  function loadTemplate(template: SavedTemplate) {
    const loadedExtraTexts = (template.extraTexts || []).map((layer) => ({ ...layer, style: { ...DEFAULT_TEXT_STYLES.extra, ...layer.style } }));
    const loadedLayouts = { ...(template.layouts || DEFAULT_CANVAS_LAYOUTS) } as CanvasLayouts;
    const productPositions = [18, 50, 82];
    template.products.forEach((_, index) => {
      const slot = index % 3;
      const labelId = `label-${index}` as CanvasElementId;
      const productId = `product-${index}` as CanvasElementId;
      if (!loadedLayouts[labelId]) loadedLayouts[labelId] = { x: productPositions[slot], y: 49, width: 31, rotation: 0 };
      if (!loadedLayouts[productId]) loadedLayouts[productId] = { x: productPositions[slot], y: 69, width: 29, rotation: 0 };
    });
    loadedExtraTexts.forEach((layer, index) => {
      const elementId = `extra-text-${layer.id}` as CanvasElementId;
      if (!loadedLayouts[elementId]) loadedLayouts[elementId] = { x: 50, y: 42 + index * 7, width: 72 };
    });
    setTemplateMode(template.mode || "ranking");
    setCanvasLayouts(loadedLayouts);
    setRankingSettings(completeRankingSettings(template.ranking));
    setRankingScenes(template.rankingScenes?.length ? template.rankingScenes.map((scene) => ({ ...scene })) : [{ id: "ranking-scene-default", title: template.title, category: template.category, duration: 5 }]);
    setSelectedRankingScene(0);
    setExtraTextLayers(loadedExtraTexts);
    setRoutineHeadings(template.routineHeadings || { day: "Dia ☀", night: "Noite ☾" });
    setQuestionBox({ ...DEFAULT_QUESTION_BOX, ...(template.questionBox || {}) });
    setSelectedElement(null);
    setSettings({
      title: template.title,
      category: template.category,
      accent: template.accent,
      removeAudio: template.removeAudio,
      removeSilence: template.removeSilence,
      thresholdDb: template.thresholdDb,
      minimumSilence: template.minimumSilence,
      padding: template.padding,
      textStyles: {
        title: { ...DEFAULT_TEXT_STYLES.title, ...template.textStyles?.title },
        category: { ...DEFAULT_TEXT_STYLES.category, ...template.textStyles?.category },
        labels: { ...DEFAULT_TEXT_STYLES.labels, ...template.textStyles?.labels },
        extra: { ...DEFAULT_TEXT_STYLES.extra, ...template.textStyles?.extra },
      },
      products: template.products.map(({ name, label }) => ({ name, label })),
    });
    setProducts(template.products.map((product) => ({
      name: product.name,
      label: product.label,
      file: product.image ? new File([product.image], `${product.name}.png`, { type: product.image.type || "image/png" }) : undefined,
      url: product.image ? URL.createObjectURL(product.image) : undefined,
    })));
    setToast("Modelo duplicado para uma nova edição");
  }

  async function deleteTemplate(id: string) {
    await removeLocalTemplate(id);
    setTemplates((current) => current.filter((template) => template.id !== id));
  }

  function skipDetectedPause() {
    const video = videoRef.current;
    if (!video || !settings.removeSilence || silentRanges.length === 0) return;
    const range = silentRanges.find((item) => video.currentTime >= item.start && video.currentTime < item.end);
    if (range) video.currentTime = Math.min(range.end, video.duration);
  }

  // Runs once per displayed frame while playing, so cuts are skipped exactly at
  // their boundary instead of up to ~250ms late (which felt like a freeze).
  function advancePlaybackPosition() {
    const video = videoRef.current;
    if (!video || video.paused || reviewingCut !== null) return;
    if (settings.removeSilence && silentRanges.length) {
      const range = silentRanges.find((item) => video.currentTime >= item.start - .004 && video.currentTime < item.end - .012);
      if (range) {
        const target = Math.min(video.duration || videoDuration, range.end + .004);
        if (target > video.currentTime) video.currentTime = target;
        return;
      }
    }
    const fallbackIndex = orderedVideoSegments.findIndex((segment) => video.currentTime >= segment.start - .04 && video.currentTime < segment.end + .04);
    const activeIndex = activeMainOrderIndexRef.current < orderedVideoSegments.length ? activeMainOrderIndexRef.current : Math.max(0, fallbackIndex);
    const activeSegment = orderedVideoSegments[activeIndex];
    if (activeSegment && video.currentTime >= activeSegment.end - .035) {
      const next = orderedVideoSegments[activeIndex + 1];
      if (next) {
        activeMainOrderIndexRef.current = activeIndex + 1;
        video.currentTime = next.start;
      } else video.pause();
    }
  }

  function startPlaybackMonitor() {
    const video = videoRef.current;
    if (!video) return;
    stopPlaybackMonitor();
    const useRVFC = typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
    playbackMonitorUsesRVFC.current = useRVFC;
    const tick = () => {
      advancePlaybackRef.current();
      const current = videoRef.current;
      if (!current || current.paused) { playbackMonitorRef.current = null; return; }
      playbackMonitorRef.current = useRVFC
        ? (current as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    };
    playbackMonitorRef.current = useRVFC
      ? (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(tick)
      : requestAnimationFrame(tick);
  }

  function stopPlaybackMonitor() {
    const id = playbackMonitorRef.current;
    if (id == null) return;
    playbackMonitorRef.current = null;
    const video = videoRef.current;
    const cancelRVFC = video && (video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback;
    if (playbackMonitorUsesRVFC.current && cancelRVFC) cancelRVFC.call(video, id);
    else cancelAnimationFrame(id);
  }

  function handleVideoTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    syncImportedAudio(video.currentTime);
    if (reviewingCut !== null) {
      const range = silentRanges[reviewingCut];
      if (!range || video.currentTime >= range.end) {
        video.pause();
        setReviewingCut(null);
      }
      return;
    }
    // The per-frame monitor handles skipping while playing; this is only a
    // fallback for when it is not running (e.g. browser throttled rAF).
    if (playbackMonitorRef.current == null) advancePlaybackPosition();
  }

  function commitCuts(next: SilentRange[], message?: string) {
    pushEditorHistory();
    setCutHistory((history) => [...history.slice(-19), silentRanges]);
    setSilentRanges(next.sort((a, b) => a.start - b.start));
    setSelectedCut(null);
    patchSettings({ removeSilence: next.length > 0 });
    if (message) setToast(message);
  }

  function undoCutChange() {
    const previous = cutHistory[cutHistory.length - 1];
    if (!previous) return;
    setSilentRanges(previous);
    setCutHistory((history) => history.slice(0, -1));
    setSelectedCut(null);
    patchSettings({ removeSilence: previous.length > 0 });
    setToast("Última correção desfeita");
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }

  function seekVideo(time: number) {
    const video = videoRef.current;
    if (!video) return;
    setReviewingCut(null);
    video.currentTime = Math.max(0, Math.min(video.duration || videoDuration, time));
    const segmentIndex = orderedVideoSegments.findIndex((segment) => video.currentTime >= segment.start - .04 && video.currentTime < segment.end + .04);
    if (segmentIndex >= 0) activeMainOrderIndexRef.current = segmentIndex;
    setCurrentTime(video.currentTime);
    syncImportedAudio(video.currentTime, { force: true });
  }

  function seekFromMainTimeline(event: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration || orderedVideoSegments.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const requested = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1) * videoDuration;
    seekMainTimelineTime(requested);
  }

  function seekMainTimelineTime(requested: number) {
    let elapsed = 0;
    for (let index = 0; index < orderedVideoSegments.length; index += 1) {
      const segment = orderedVideoSegments[index];
      const duration = segment.end - segment.start;
      if (requested <= elapsed + duration || index === orderedVideoSegments.length - 1) {
        activeMainOrderIndexRef.current = index;
        seekVideo(segment.start + clamp(requested - elapsed, 0, duration));
        return;
      }
      elapsed += duration;
    }
  }

  function seekFromTimeline(event: React.MouseEvent<HTMLDivElement>) {
    if (!videoDuration) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seekVideo(((event.clientX - bounds.left) / bounds.width) * videoDuration);
  }

  function zoomTimeline(direction: number) {
    setTimelineZoom((current) => clamp(Number((current + direction).toFixed(2)), 1, 12));
  }

  function handleTimelineWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    zoomTimeline(event.deltaY < 0 ? .35 : -.35);
  }

  // Coalesces rapid pointermove work into one update per animation frame, so
  // scrubbing/trimming issues at most one seek + render per frame instead of
  // one per mouse event (which caused the heavy drag lag).
  function scheduleDragUpdate(task: () => void) {
    dragTaskRef.current = task;
    if (dragRafRef.current) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = 0;
      const run = dragTaskRef.current;
      dragTaskRef.current = null;
      run?.();
    });
  }

  function seekPlayheadFromClient(clientX: number, element: HTMLElement) {
    if (!videoDuration) return;
    const bounds = element.getBoundingClientRect();
    seekMainTimelineTime(clamp((clientX - bounds.left) / Math.max(1, bounds.width)) * videoDuration);
  }

  function beginPlayheadDrag(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    playheadDragRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const layer = event.currentTarget.parentElement;
    if (layer) seekPlayheadFromClient(event.clientX, layer);
  }

  function movePlayheadDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (playheadDragRef.current !== event.pointerId) return;
    const layer = event.currentTarget.parentElement;
    const clientX = event.clientX;
    if (layer) scheduleDragUpdate(() => seekPlayheadFromClient(clientX, layer));
  }

  function endPlayheadDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (playheadDragRef.current !== event.pointerId) return;
    playheadDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function beginTimelineResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: timelineHeight };
  }

  function moveTimelineResize(event: React.PointerEvent<HTMLDivElement>) {
    const resize = timelineResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const maximum = Math.max(260, window.innerHeight - 250);
    setTimelineHeight(Math.round(clamp(resize.startHeight - (event.clientY - resize.startY), 180, maximum)));
    setTimelineCollapsed(false);
  }

  function endTimelineResize(event: React.PointerEvent<HTMLDivElement>) {
    if (timelineResizeRef.current?.pointerId !== event.pointerId) return;
    timelineResizeRef.current = null;
    window.localStorage.setItem("clippronto-timeline-height", String(timelineHeight));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function rankingStart(index: number) {
    return rankingSettings.revealMode === "all" ? rankingSettings.itemTimes[0] : rankingSettings.itemTimes[index];
  }

  function rankingEnd(index: number) {
    const start = rankingStart(index);
    const availableEnd = videoDuration || start + 5;
    return Math.max(start + .12, Math.min(rankingSettings.itemEndTimes[index] ?? availableEnd, availableEnd));
  }

  function beginTimelineClipDrag(event: React.PointerEvent<HTMLElement>, selection: TimelineSelection, mode: "move" | "trim-start" | "trim-end") {
    if (selection.kind !== "ranking" && selection.kind !== "broll") return;
    const track = event.currentTarget.closest(".timeline-track");
    if (!(track instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pushEditorHistory();
    setTimelineSelection(selection);
    if (selection.kind === "ranking") {
      timelineClipDragRef.current = {
        pointerId: event.pointerId,
        kind: "ranking",
        index: selection.index,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        width: track.getBoundingClientRect().width,
        initialStart: rankingStart(selection.index),
        initialEnd: rankingEnd(selection.index),
        initialLayer: rankingSettings.itemLayers[selection.index] ?? selection.index,
      };
      return;
    }
    const clip = brollClips.find((item) => item.id === selection.id);
    if (!clip) return;
    timelineClipDragRef.current = {
      pointerId: event.pointerId,
      kind: "broll",
      id: selection.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      width: track.getBoundingClientRect().width,
      initialStart: clip.timelineStart,
      initialEnd: clip.timelineStart + clip.duration,
      initialLayer: clip.layer ?? 0,
      initialSourceStart: clip.sourceStart,
    };
  }

  function moveTimelineClip(event: React.PointerEvent<HTMLElement>) {
    const drag = timelineClipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !videoDuration) return;
    event.preventDefault();
    const deltaTime = (event.clientX - drag.startX) / Math.max(1, drag.width) * videoDuration;
    const duration = drag.initialEnd - drag.initialStart;
    const nextLayer = Math.round(clamp(drag.initialLayer + (event.clientY - drag.startY) / 24, 0, 9));
    if (drag.kind === "ranking" && drag.index !== undefined) {
      const index = drag.index;
      setRankingSettings((current) => {
        const itemTimes = [...current.itemTimes];
        const itemEndTimes = [...current.itemEndTimes];
        const itemLayers = [...current.itemLayers];
        if (drag.mode === "move") {
          const start = clamp(drag.initialStart + deltaTime, 0, Math.max(0, videoDuration - duration));
          if (current.revealMode === "all") itemTimes[0] = start;
          else itemTimes[index] = start;
          itemEndTimes[index] = start + duration;
          itemLayers[index] = nextLayer;
        } else if (drag.mode === "trim-start") {
          const start = clamp(drag.initialStart + deltaTime, 0, drag.initialEnd - .12);
          if (current.revealMode === "all") itemTimes[0] = start;
          else itemTimes[index] = start;
        } else {
          itemEndTimes[index] = clamp(drag.initialEnd + deltaTime, drag.initialStart + .12, videoDuration);
        }
        return { ...current, itemTimes, itemEndTimes, itemLayers };
      });
      return;
    }
    if (drag.kind === "broll" && drag.id) {
      const patch: Partial<BrollClip> = { layer: nextLayer };
      if (drag.mode === "move") patch.timelineStart = clamp(drag.initialStart + deltaTime, 0, Math.max(0, videoDuration - duration));
      else if (drag.mode === "trim-start") {
        const start = clamp(drag.initialStart + deltaTime, 0, drag.initialEnd - .12);
        patch.timelineStart = start;
        patch.duration = drag.initialEnd - start;
        patch.sourceStart = (drag.initialSourceStart || 0) + start - drag.initialStart;
      } else patch.duration = clamp(duration + deltaTime, .12, videoDuration - drag.initialStart);
      updateBroll(drag.id, patch);
    }
  }

  function endTimelineClipDrag(event: React.PointerEvent<HTMLElement>) {
    if (timelineClipDragRef.current?.pointerId !== event.pointerId) return;
    timelineClipDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function normalizeFactoryClipRange(clip: FactoryClip, sourceStart: number, sourceEnd: number): FactoryClip {
    const start = clamp(sourceStart, clip.sourceLimitStart ?? 0, Math.max(0, (clip.sourceLimitEnd ?? sourceEnd) - .12));
    const end = clamp(sourceEnd, start + .12, clip.sourceLimitEnd ?? sourceEnd);
    const availableRanges = clip.availableSilentRanges || clip.silentRanges;
    const silentRanges = availableRanges
      .map((range) => ({ ...range, start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter((range) => range.end - range.start >= .08);
    return {
      ...clip,
      sourceStart: start,
      sourceEnd: end,
      duration: end - start,
      silentRanges,
      removedSeconds: silentRanges.reduce((total, range) => total + range.end - range.start, 0),
    };
  }

  function rebuildFactoryStructure(sequence: [FactoryClip, FactoryClip, FactoryClip]) {
    let cursor = 0;
    const ranges = sequence.map((clip) => {
      const start = cursor;
      cursor += Math.max(.1, clip.duration - clip.removedSeconds);
      return { section: clip.section, start, end: cursor } as FactoryStructureRange;
    });
    setFactoryStructureRanges(ranges);
    setVideoDuration(cursor);
    knownVideoDurationRef.current = cursor;
  }

  function patchActiveFactorySequence(sequence: [FactoryClip, FactoryClip, FactoryClip]) {
    setActiveFactorySequence(sequence);
    rebuildFactoryStructure(sequence);
    if (activeFactoryProjectId) {
      setFactoryProjects((current) => current.map((project) => project.id === activeFactoryProjectId ? { ...project, clips: sequence } : project));
    }
  }

  async function refreshFactoryEditorVideo(sequence: [FactoryClip, FactoryClip, FactoryClip]) {
    const project = activeFactoryProjectId ? factoryProjects.find((item) => item.id === activeFactoryProjectId) : undefined;
    const baseVariant = project ? factoryVariants.find((item) => item.id === project.variantId) : undefined;
    if (!project || !baseVariant) return;
    setFactoryPreparing(true);
    try {
      const duration = sequence.reduce((total, clip) => total + Math.max(.1, clip.duration - clip.removedSeconds), 0);
      const blob = await renderFactoryVariant({ ...baseVariant, hook: sequence[0], body: sequence[1], cta: sequence[2], duration });
      const safeName = (project.name.trim() || "conteudo").replace(/[\\/:*?"<>|]+/g, "-");
      const file = new File([blob], `${safeName}.webm`, { type: blob.type || "video/webm" });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const nextUrl = URL.createObjectURL(file);
      setVideoFile(file);
      setVideoUrl(nextUrl);
      setVideoDuration(duration);
      knownVideoDurationRef.current = duration;
      let cleanCursor = 0;
      const removedRanges: FactoryRemovedRange[] = [];
      sequence.forEach((clip) => {
        const sourceOrigin = clip.sourceStart ?? 0;
        let removedBefore = 0;
        clip.silentRanges.forEach((range) => {
          removedRanges.push({ at: cleanCursor + Math.max(0, range.start - sourceOrigin - removedBefore), duration: range.end - range.start, section: clip.section, sourceStart: range.start, sourceEnd: range.end });
          removedBefore += range.end - range.start;
        });
        cleanCursor += Math.max(.1, clip.duration - clip.removedSeconds);
      });
      setFactoryRemovedRanges(removedRanges);
      void buildWaveform(file).then((waveform) => setWaveformSamples(waveform.samples));
      patchFactoryProject(project.id, { status: "adjusting" });
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível atualizar o corte da Fábrica");
    } finally {
      setFactoryPreparing(false);
    }
  }

  function beginFactoryTrim(event: React.PointerEvent<HTMLButtonElement>, index: number, edge: "start" | "end") {
    if (!activeFactorySequence) return;
    const track = event.currentTarget.closest(".factory-video-track");
    if (!(track instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const initialSequence = activeFactorySequence.map((clip) => ({ ...clip, silentRanges: clip.silentRanges.map((range) => ({ ...range })) })) as [FactoryClip, FactoryClip, FactoryClip];
    factoryTrimDragRef.current = { pointerId: event.pointerId, index, edge, startX: event.clientX, width: track.getBoundingClientRect().width, initialSequence, draftSequence: initialSequence };
    setTimelineSelection({ kind: "factory", index });
  }

  function moveFactoryTrim(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = factoryTrimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const clip = drag.initialSequence[drag.index];
    const deltaTime = (event.clientX - drag.startX) / Math.max(1, drag.width) * Math.max(videoDuration, factorySequenceDuration, 1);
    const start = clip.sourceStart ?? 0;
    const end = clip.sourceEnd ?? start + clip.duration;
    const updated = drag.edge === "start"
      ? normalizeFactoryClipRange(clip, start + deltaTime, end)
      : normalizeFactoryClipRange(clip, start, end + deltaTime);
    const next = drag.initialSequence.map((item, index) => index === drag.index ? updated : item) as [FactoryClip, FactoryClip, FactoryClip];
    drag.draftSequence = next;
    patchActiveFactorySequence(next);
  }

  function endFactoryTrim(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = factoryTrimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    factoryTrimDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const clip = drag.draftSequence[drag.index];
    setToast(`${clip.section === "hook" ? "Hook" : clip.section === "body" ? "Corpo" : "CTA"} ajustado para ${formatTime(clip.duration - clip.removedSeconds)}`);
    void refreshFactoryEditorVideo(drag.draftSequence);
  }

  function nudgeFactoryClip(index: number, edge: "start" | "end", amount: number) {
    if (!activeFactorySequence) return;
    const clip = activeFactorySequence[index];
    const start = clip.sourceStart ?? 0;
    const end = clip.sourceEnd ?? start + clip.duration;
    const updated = edge === "start" ? normalizeFactoryClipRange(clip, start + amount, end) : normalizeFactoryClipRange(clip, start, end + amount);
    const next = activeFactorySequence.map((item, itemIndex) => itemIndex === index ? updated : item) as [FactoryClip, FactoryClip, FactoryClip];
    patchActiveFactorySequence(next);
    setTimelineSelection({ kind: "factory", index });
    void refreshFactoryEditorVideo(next);
  }

  function splitMainAt(time: number) {
    if (!videoDuration || time <= .08 || time >= videoDuration - .08) return;
    if (videoSplits.some((split) => Math.abs(split - time) < .08)) return;
    pushEditorHistory();
    const parentIndex = orderedVideoSegments.findIndex((segment) => time > segment.start + .07 && time < segment.end - .07);
    const parentStart = orderedVideoSegments[parentIndex]?.start ?? 0;
    setVideoSplits((current) => current.some((split) => Math.abs(split - time) < .08)
      ? current
      : [...current, time].sort((a, b) => a - b));
    setMainSegmentOrder((current) => {
      const base = current.length ? [...current] : videoSegments.map((segment) => segment.start);
      const position = base.findIndex((start) => Math.abs(start - parentStart) < .08);
      base.splice(position >= 0 ? position + 1 : base.length, 0, time);
      return base;
    });
    setToast(`Vídeo dividido em ${formatTime(time)}`);
  }

  function beginMainTrim(event: React.PointerEvent<HTMLButtonElement>, index: number, edge: "start" | "end") {
    const segment = orderedVideoSegments[index];
    const track = event.currentTarget.closest(".main-track");
    if (!segment || !(track instanceof HTMLElement)) return;
    const baseIndex = videoSegments.findIndex((item) => Math.abs(item.start - segment.start) < .08);
    const splitIndex = edge === "start" ? baseIndex - 1 : baseIndex;
    if (splitIndex < 0 || splitIndex >= videoSplits.length) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const previous = videoSplits[splitIndex - 1] ?? 0;
    const next = videoSplits[splitIndex + 1] ?? videoDuration;
    mainTrimDragRef.current = { pointerId: event.pointerId, index: splitIndex, edge, startX: event.clientX, width: track.getBoundingClientRect().width, initialBoundary: videoSplits[splitIndex], minimum: previous + .12, maximum: next - .12 };
    setTimelineSelection({ kind: "main", index });
  }

  function moveMainTrim(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = mainTrimDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientX = event.clientX;
    scheduleDragUpdate(() => {
      const boundary = clamp(drag.initialBoundary + (clientX - drag.startX) / Math.max(1, drag.width) * videoDuration, drag.minimum, drag.maximum);
      setVideoSplits((current) => current.map((time, index) => index === drag.index ? boundary : time));
      setMainSegmentOrder((current) => current.map((start) => Math.abs(start - drag.initialBoundary) < .08 ? boundary : start));
    });
  }

  function endMainTrim(event: React.PointerEvent<HTMLButtonElement>) {
    if (mainTrimDragRef.current?.pointerId !== event.pointerId) return;
    mainTrimDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setToast("Ponto de ligação entre os vídeos ajustado");
  }

  function splitMainVideo() {
    splitMainAt(currentTime);
  }

  function adjustMainSegmentEdge(index: number, edge: "start" | "end", amount: number) {
    const segment = orderedVideoSegments[index];
    if (!segment) return;
    const baseIndex = videoSegments.findIndex((item) => Math.abs(item.start - segment.start) < .08);
    const splitIndex = edge === "start" ? baseIndex - 1 : baseIndex;
    if (splitIndex < 0 || splitIndex >= videoSplits.length) return;
    pushEditorHistory();
    const oldBoundary = videoSplits[splitIndex];
    const newBoundary = clamp(oldBoundary + amount, (videoSplits[splitIndex - 1] ?? 0) + .12, (videoSplits[splitIndex + 1] ?? videoDuration) - .12);
    setVideoSplits((current) => current.map((time, itemIndex) => itemIndex === splitIndex ? newBoundary : time));
    setMainSegmentOrder((current) => current.map((start) => Math.abs(start - oldBoundary) < .08 ? newBoundary : start));
  }

  function removeMainSegment(index: number) {
    const segment = orderedVideoSegments[index];
    if (!segment) return;
    commitCuts([...silentRanges, { ...segment, origin: "manual" }], "Trecho do vídeo enviado para Removidos");
    setTimelineSelection(null);
  }

  function deleteMainSide(side: "left" | "right") {
    const index = timelineSelection?.kind === "main" ? timelineSelection.index : orderedVideoSegments.findIndex((segment) => currentTime >= segment.start && currentTime <= segment.end);
    const segment = orderedVideoSegments[index];
    if (!segment) return;
    const cursor = clamp(currentTime, segment.start, segment.end);
    const range = side === "left" ? { start: segment.start, end: cursor } : { start: cursor, end: segment.end };
    if (range.end - range.start < .06) return setToast("Posicione o cursor dentro do trecho antes de excluir");
    commitCuts([...silentRanges, { ...range, origin: "manual" }], side === "left" ? "Parte à esquerda enviada para Removidos" : "Parte à direita enviada para Removidos");
  }

  function moveMainSegment(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= orderedVideoSegments.length) return;
    pushEditorHistory();
    const next = orderedVideoSegments.map((segment) => segment.start);
    [next[index], next[destination]] = [next[destination], next[index]];
    setMainSegmentOrder(next);
    setTimelineSelection({ kind: "main", index: destination });
    activeMainOrderIndexRef.current = destination;
    setToast("Trecho reposicionado na timeline");
  }

  function reorderMainSegment(sourceIndex: number, destinationIndex: number) {
    if (sourceIndex === destinationIndex || sourceIndex < 0 || destinationIndex < 0) return;
    pushEditorHistory();
    const next = orderedVideoSegments.map((segment) => segment.start);
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(destinationIndex, 0, moved);
    setMainSegmentOrder(next);
    setTimelineSelection({ kind: "main", index: destinationIndex });
    activeMainOrderIndexRef.current = destinationIndex;
    setToast("Trecho arrastado para uma nova posição");
  }

  function extractMainAudio() {
    pushEditorHistory();
    setAudioExtracted(true);
    setSettings((current) => ({ ...current, removeAudio: false }));
    setTimelineSelection({ kind: "audio" });
    setToast("Áudio extraído para uma faixa separada");
  }

  function addTimelineMarker() {
    const label = `Marcador ${timelineMarkers.length + 1}`;
    pushEditorHistory();
    setTimelineMarkers((current) => [...current, { id: crypto.randomUUID(), time: mainTimelineCurrentTime, label, color: "#f4c94e" }].sort((first, second) => first.time - second.time));
    setToast(`${label} adicionado em ${formatTime(mainTimelineCurrentTime)}`);
  }

  function changePlaybackSpeed(speed: number) {
    if (Math.abs(speed - playbackSpeed) < .001) return;
    pushEditorHistory();
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setToast(`Velocidade ajustada para ${speed.toFixed(2).replace(".00", "")}×`);
  }

  function moveRankingLayer(index: number, direction: -1 | 1) {
    setRankingSettings((current) => ({
      ...current,
      itemLayers: current.itemLayers.map((layer, itemIndex) => itemIndex === index ? Math.round(clamp(layer + direction, 0, 9)) : layer),
    }));
  }

  function duplicateRankingItem(index: number) {
    if (rankingSettings.count >= 10) return setToast("O ranking já possui o limite de 10 itens");
    const destination = rankingSettings.count;
    const source = products[index];
    setProducts((current) => current.map((product, itemIndex) => itemIndex === destination ? {
      ...source,
      name: `${source.name} cópia`,
      url: source.file ? URL.createObjectURL(source.file) : source.url,
    } : product));
    setRankingSettings((current) => {
      const itemTimes = [...current.itemTimes];
      const itemEndTimes = [...current.itemEndTimes];
      const itemLayers = [...current.itemLayers];
      const itemScales = [...current.itemScales];
      itemTimes[destination] = Math.min(videoDuration || 9_999, rankingStart(index) + .35);
      itemEndTimes[destination] = current.itemEndTimes[index];
      itemLayers[destination] = Math.min(9, (current.itemLayers[index] ?? index) + 1);
      itemScales[destination] = current.itemScales[index] ?? 1;
      return { ...current, count: current.count + 1, itemTimes, itemEndTimes, itemLayers, itemScales };
    });
    setTimelineSelection({ kind: "ranking", index: destination });
    setToast("Item duplicado em uma nova camada");
  }

  function removeRankingItem(index: number) {
    if (rankingSettings.count <= 1) return setToast("O ranking precisa manter pelo menos um item");
    setProducts((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      next.push({ name: `Item ${next.length + 1}`, label: "" });
      return next;
    });
    setRankingSettings((current) => ({
      ...current,
      count: current.count - 1,
      itemTimes: [...current.itemTimes.slice(0, index), ...current.itemTimes.slice(index + 1), DEFAULT_RANKING_TIMES[index]].slice(0, 10),
      itemEndTimes: [...current.itemEndTimes.slice(0, index), ...current.itemEndTimes.slice(index + 1), 9_999].slice(0, 10),
      itemLayers: [...current.itemLayers.slice(0, index), ...current.itemLayers.slice(index + 1), 9].slice(0, 10),
      itemScales: [...current.itemScales.slice(0, index), ...current.itemScales.slice(index + 1), 1].slice(0, 10),
    }));
    setTimelineSelection(null);
    setToast("Item removido do ranking");
  }

  function jumpToCut(direction: -1 | 1) {
    if (!silentRanges.length) return;
    const currentIndex = selectedCut ?? (direction > 0 ? -1 : silentRanges.length);
    const nextIndex = Math.max(0, Math.min(silentRanges.length - 1, currentIndex + direction));
    setSelectedCut(nextIndex);
    seekVideo(Math.max(0, silentRanges[nextIndex].start - 0.25));
  }

  function addManualCut() {
    if (!videoDuration) return;
    const start = Math.max(0, currentTime - 0.2);
    const end = Math.min(videoDuration, currentTime + 0.6);
    commitCuts([...silentRanges, { start, end, origin: "manual" }], "Novo trecho marcado para remoção");
    setAnalysisStatus("done");
  }

  function restoreCut(index: number) {
    commitCuts(silentRanges.filter((_, itemIndex) => itemIndex !== index), "Trecho restaurado no vídeo");
  }

  function restoreAllCuts() {
    if (!silentRanges.length) return;
    commitCuts([], "Todos os trechos foram restaurados");
  }

  function adjustCut(index: number, edge: "start" | "end", amount: number) {
    pushEditorHistory();
    const next = silentRanges.map((range, itemIndex) => {
      if (itemIndex !== index) return range;
      if (edge === "start") return { ...range, start: Math.max(0, Math.min(range.end - 0.08, range.start + amount)) };
      return { ...range, end: Math.min(videoDuration, Math.max(range.start + 0.08, range.end + amount)) };
    });
    setCutHistory((history) => [...history.slice(-19), silentRanges]);
    setSilentRanges(next);
    setToast("Limite do corte ajustado");
  }

  function previewRemovedCut(index: number) {
    const video = videoRef.current;
    const range = silentRanges[index];
    if (!video || !range) return;
    setSelectedCut(index);
    setReviewingCut(index);
    video.currentTime = range.start;
    video.play();
  }

  async function readVideoDuration(url: string) {
    return new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.onerror = () => reject(new Error("Não foi possível ler o vídeo"));
      video.src = url;
    });
  }

  async function inspectFactoryClip(file: File, url: string) {
    let duration = await readVideoDuration(url).catch(() => 0);
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      duration = buffer.duration || duration;
      const sampleRate = buffer.sampleRate;
      const windowSize = Math.max(1, Math.round(sampleRate * .025));
      const threshold = Math.pow(10, settings.thresholdDb / 20);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const raw: SilentRange[] = [];
      const voicedRms: number[] = [];
      let silenceStart: number | null = null;

      for (let offset = 0; offset < buffer.length; offset += windowSize) {
        const end = Math.min(buffer.length, offset + windowSize);
        let squares = 0;
        let count = 0;
        for (const channel of channels) {
          for (let sample = offset; sample < end; sample += 2) {
            squares += channel[sample] * channel[sample];
            count++;
          }
        }
        const rms = Math.sqrt(squares / Math.max(1, count));
        const time = offset / sampleRate;
        if (rms <= threshold && silenceStart === null) silenceStart = time;
        if (rms > threshold) {
          voicedRms.push(rms);
          if (silenceStart !== null) {
            if (time - silenceStart >= settings.minimumSilence) raw.push({ start: silenceStart, end: time, origin: "automatic" });
            silenceStart = null;
          }
        }
      }
      if (silenceStart !== null && duration - silenceStart >= settings.minimumSilence) raw.push({ start: silenceStart, end: duration, origin: "automatic" });
      const silentRanges = raw
        .map((range) => ({ start: Math.max(0, range.start + settings.padding), end: Math.min(duration, range.end - settings.padding), origin: "automatic" as const }))
        .filter((range) => range.end - range.start >= .08);
      const removedSeconds = silentRanges.reduce((total, range) => total + range.end - range.start, 0);
      const averageRms = voicedRms.length ? voicedRms.reduce((total, rms) => total + rms, 0) / voicedRms.length : .1;
      await context.close();
      return { duration, silentRanges, removedSeconds, averageRms };
    } catch {
      return { duration, silentRanges: [] as SilentRange[], removedSeconds: 0, averageRms: .1 };
    }
  }

  function createFactoryFragment(file: File, section: FactorySection, start: number, end: number, analysis: Awaited<ReturnType<typeof inspectFactoryClip>>, index = 0, sourceText = ""): FactoryClip {
    const silentRanges = analysis.silentRanges
      .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end), origin: range.origin }))
      .filter((range) => range.end - range.start >= .08);
    const removedSeconds = silentRanges.reduce((total, range) => total + range.end - range.start, 0);
    const sectionName = section === "hook" ? `Gancho ${index + 1}` : section === "body" ? "Corpo mantido" : "CTA mantido";
    return {
      id: crypto.randomUUID(),
      section,
      file,
      url: URL.createObjectURL(file),
      name: `${sectionName} · ${formatTime(start)}–${formatTime(end)}`,
      duration: Math.max(.1, end - start),
      silentRanges,
      removedSeconds,
      averageRms: analysis.averageRms,
      status: "ready",
      sourceStart: start,
      sourceEnd: end,
      sourceText,
      hookFormat: section === "hook" ? "standard" : undefined,
      availableSilentRanges: analysis.silentRanges.map((range) => ({ ...range })),
      sourceLimitStart: 0,
      sourceLimitEnd: analysis.duration,
    };
  }

  async function transcribeFactoryContext(file: File): Promise<TranscriptChunk[]> {
    let audioContext: AudioContext | null = null;
    try {
      const transformers = await import("@huggingface/transformers");
      transformers.env.useBrowserCache = true;
      transformers.env.allowLocalModels = false;
      const supportsWebGpu = "gpu" in navigator;
      const transcriber = await transformers.pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-base",
        { device: supportsWebGpu ? "webgpu" : "wasm", dtype: supportsWebGpu ? "fp16" : "q8" },
      );
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioContextClass();
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      const targetRate = 16_000;
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const result = await transcriber(new Float32Array(rendered.getChannelData(0)), {
        language: "portuguese",
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 6,
        return_timestamps: true,
      }) as unknown as { chunks?: Array<{ text?: string; timestamp?: [number, number | null] }> };
      return (result.chunks || []).map((chunk) => ({
        text: (chunk.text || "").trim(),
        timestamp: chunk.timestamp || [0, null],
      })).filter((chunk) => chunk.text && Number.isFinite(chunk.timestamp[0]));
    } catch (error) {
      console.warn("A análise semântica local da Fábrica não ficou disponível; usando pausas e energia da fala.", error);
      return [];
    } finally {
      if (audioContext) await audioContext.close().catch(() => undefined);
    }
  }

  async function analyzeSingleFactoryVideo(file = singleFactoryFile) {
    if (!file || singleFactoryStatus === "analyzing") return;
    Object.values(factoryClips).flat().forEach((clip) => URL.revokeObjectURL(clip.url));
    if (singleFactoryUrl) URL.revokeObjectURL(singleFactoryUrl);
    const previewUrl = URL.createObjectURL(file);
    setSingleFactoryFile(file);
    setSingleFactoryUrl(previewUrl);
    setSingleFactoryStatus("analyzing");
    setFactoryGenerated(false);
    setFactorySelectedIds([]);
    setFactoryProjects([]);
    try {
      const analysis = await inspectFactoryClip(file, previewUrl);
      if (analysis.duration < 5) throw new Error("Use um vídeo com pelo menos 5 segundos para criar variações de gancho");
      const total = analysis.duration;
      const ctaLength = Math.min(Math.max(total * .16, 1.5), Math.min(6, total * .25));
      const ctaStart = Math.max(total * .68, total - ctaLength);
      const hookRegionEnd = Math.max(1.8, Math.min(ctaStart - .6, Math.max(2.5, total * .32)));
      const bodyStart = hookRegionEnd;
      const bodyEnd = Math.max(bodyStart + .8, ctaStart);
      const phraseCandidates: Array<{ start: number; end: number; score: number; text?: string }> = [];
      const transcript = await transcribeFactoryContext(file);
      const attentionPattern = /\b(voc[eê]|sabia|segredo|erro|nunca|pare|aten[cç][aã]o|cuidado|verdade|mito|motivo|como|por que|porque|antes|depois|melhor|pior|ningu[eé]m|descobri|testei|resultado|passo|dica)\b/i;
      transcript.forEach((chunk, index) => {
        const chunkEnd = chunk.timestamp[1] ?? chunk.timestamp[0] + 4.2;
        if (chunkEnd <= bodyStart || chunk.timestamp[0] >= bodyEnd) return;
        const rawStart = clamp(chunk.timestamp[0], bodyStart, Math.max(bodyStart, bodyEnd - .75));
        const rawEnd = clamp(chunkEnd, rawStart + .75, bodyEnd);
        const duration = Math.min(6, rawEnd - rawStart);
        if (duration < .75) return;
        const punctuationScore = /[?!]/.test(chunk.text) ? 2.4 : 0;
        const attentionScore = attentionPattern.test(chunk.text) ? 2.2 : 0;
        const earlyScore = 1.4 * (1 - (rawStart - bodyStart) / Math.max(1, bodyEnd - bodyStart));
        phraseCandidates.push({ start: rawStart, end: rawStart + duration, score: 12 + punctuationScore + attentionScore + earlyScore - Math.abs(3.4 - duration) - index * .015, text: chunk.text });
      });
      let cursor = bodyStart;
      analysis.silentRanges.forEach((range) => {
        if (range.end <= bodyStart || range.start >= bodyEnd) return;
        const phraseEnd = Math.min(bodyEnd, range.start);
        if (phraseEnd - cursor >= .75) {
          const end = Math.min(phraseEnd, cursor + 5.2);
          const duration = end - cursor;
          phraseCandidates.push({ start: cursor, end, score: 10 - Math.abs(3.4 - duration) + (bodyEnd - cursor) / Math.max(1, bodyEnd - bodyStart) });
        }
        cursor = Math.max(cursor, Math.min(bodyEnd, range.end));
      });
      if (bodyEnd - cursor >= .75) {
        const end = Math.min(bodyEnd, cursor + 5.2);
        phraseCandidates.push({ start: cursor, end, score: 10 - Math.abs(3.4 - (end - cursor)) });
      }
      const bodyDuration = Math.max(.75, bodyEnd - bodyStart);
      const fallbackLength = Math.min(4.2, Math.max(.75, bodyDuration * .32));
      for (let index = 0; index < singleFactoryHookCount * 2; index++) {
        const ratio = index / Math.max(1, singleFactoryHookCount * 2 - 1);
        const start = bodyStart + Math.max(0, (bodyDuration - fallbackLength) * ratio);
        const end = Math.min(bodyEnd, start + fallbackLength);
        phraseCandidates.push({ start, end, score: 6 - Math.abs(.5 - ratio) * .3 });
      }
      const selected: Array<{ start: number; end: number; text?: string }> = [];
      [...phraseCandidates].sort((first, second) => second.score - first.score).forEach((candidate) => {
        if (selected.length >= singleFactoryHookCount) return;
        if (selected.every((item) => Math.abs(item.start - candidate.start) > .22 || Math.abs(item.end - candidate.end) > .22)) selected.push(candidate);
      });
      while (selected.length < singleFactoryHookCount) {
        const index = selected.length;
        const length = Math.max(.75, Math.min(bodyDuration, fallbackLength * (1 - index * .05)));
        const start = bodyStart + Math.max(0, Math.min(bodyDuration - length, index * .18));
        selected.push({ start, end: start + length });
      }
      selected.sort((first, second) => first.start - second.start);
      const hooks = selected.map((range, index) => {
        const matchingSpeech = range.text || transcript.find((chunk) => (chunk.timestamp[1] ?? chunk.timestamp[0] + 3) > range.start && chunk.timestamp[0] < range.end)?.text || `Trecho do corpo ${index + 1}`;
        return createFactoryFragment(file, "hook", range.start, range.end, analysis, index, matchingSpeech);
      });
      const body = createFactoryFragment(file, "body", bodyStart, bodyEnd, analysis);
      const cta = createFactoryFragment(file, "cta", ctaStart, total, analysis);
      setFactoryClips({ hook: hooks, body: [body], cta: [cta] });
      setSingleFactoryStatus("ready");
      setToast(`${hooks.length} ganchos retirados do Corpo · Corpo e CTA mantidos`);
    } catch (error) {
      setFactoryClips({ hook: [], body: [], cta: [] });
      setSingleFactoryStatus("error");
      setToast(error instanceof Error ? error.message : "Não foi possível analisar o vídeo único");
    }
  }

  async function addFactoryFiles(section: FactorySection, files: FileList | null) {
    if (!files?.length) return;
    const remaining = Math.max(0, 3 - factoryClips[section].length);
    const selected = Array.from(files).filter((file) => file.type.startsWith("video/")).slice(0, remaining);
    if (!selected.length) {
      setToast(remaining ? "Escolha arquivos de vídeo" : "O limite desta etapa é de 3 vídeos");
      return;
    }
    const provisional = selected.map<FactoryClip>((file) => ({
      id: crypto.randomUUID(), section, file, url: URL.createObjectURL(file), name: file.name,
      duration: 0, silentRanges: [], removedSeconds: 0, averageRms: .1, status: "analyzing",
    }));
    setFactoryGenerated(false);
    setFactoryClips((current) => ({ ...current, [section]: [...current[section], ...provisional] }));
    await Promise.all(provisional.map(async (clip) => {
      try {
        const analysis = await inspectFactoryClip(clip.file, clip.url);
        setFactoryClips((current) => ({
          ...current,
          [section]: current[section].map((item) => item.id === clip.id ? { ...item, ...analysis, availableSilentRanges: analysis.silentRanges.map((range) => ({ ...range })), sourceStart: 0, sourceEnd: analysis.duration, sourceLimitStart: 0, sourceLimitEnd: analysis.duration, status: "ready" } : item),
        }));
      } catch {
        setFactoryClips((current) => ({
          ...current,
          [section]: current[section].map((item) => item.id === clip.id ? { ...item, status: "error" } : item),
        }));
      }
    }));
  }

  function removeFactoryClip(section: FactorySection, id: string) {
    setFactoryClips((current) => {
      const target = current[section].find((clip) => clip.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return { ...current, [section]: current[section].filter((clip) => clip.id !== id) };
    });
    setFactoryGenerated(false);
    setFactorySelectedIds([]);
  }

  function updateFactoryHook(id: string, patch: Partial<Pick<FactoryClip, "hookFormat" | "sourceText">>) {
    setFactoryClips((current) => ({
      ...current,
      hook: current.hook.map((clip) => clip.id === id ? { ...clip, ...patch } : clip),
    }));
  }

  function generateFactoryVariants() {
    if (!factoryVariants.length) {
      setToast("Adicione pelo menos 1 Hook, 1 Corpo e 1 CTA");
      return;
    }
    setFactoryGenerated(true);
    setFactorySelectedIds(factoryVariants.map((variant) => variant.id));
    setFactoryProjects((current) => factoryVariants.map((variant, index) => {
      const existing = current.find((project) => project.variantId === variant.id);
      return existing || { id: crypto.randomUUID(), variantId: variant.id, name: `Conteúdo ${String(index + 1).padStart(2, "0")}`, status: "adjusting" };
    }));
    setToast(`${factoryVariants.length} combinações criadas na ordem Hook → Corpo → CTA`);
  }

  function patchFactoryProject(id: string, patch: Partial<Pick<FactoryProject, "name" | "status">>) {
    setFactoryProjects((current) => current.map((project) => project.id === id ? { ...project, ...patch } : project));
  }

  function editFirstSelectedFactoryProject() {
    const project = factoryProjects.find((item) => factorySelectedIds.includes(item.variantId) && item.status !== "downloaded")
      || factoryProjects.find((item) => factorySelectedIds.includes(item.variantId));
    if (project) openFactoryProjectInEditor(project.id);
    else setToast("Selecione pelo menos uma variação para editar");
  }

  function chooseFactorySplitVideo(file?: File) {
    if (!file) return;
    if (factorySplitUrl) URL.revokeObjectURL(factorySplitUrl);
    setFactorySplitFile(file);
    setFactorySplitUrl(URL.createObjectURL(file));
  }

  async function prepareFactoryVideo(url: string) {
    const video = document.createElement("video");
    video.src = url;
    video.preload = "auto";
    video.playsInline = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Falha ao preparar um dos vídeos"));
    });
    return video;
  }

  async function renderFactoryVariant(variant: FactoryVariant) {
    const preset = EXPORT_PRESETS[exportPresetId];
    const canvas = document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Seu navegador não conseguiu criar a composição");
    const clips = [variant.hook, variant.body, variant.cta];
    const videos = await Promise.all(clips.map((clip) => prepareFactoryVideo(clip.url)));
    const hookNeedsSupport = variant.hook.hookFormat === "split" || variant.hook.hookFormat === "react";
    const supportVideo = (factoryStyle === "split" || hookNeedsSupport) && factorySplitUrl ? await prepareFactoryVideo(factorySplitUrl) : null;
    if (supportVideo) { supportVideo.muted = true; supportVideo.loop = true; await supportVideo.play().catch(() => undefined); }

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioContextClass();
    const audioDestination = audioContext.createMediaStreamDestination();
    videos.forEach((video, index) => {
      const source = audioContext.createMediaElementSource(video);
      const gain = audioContext.createGain();
      gain.gain.value = clamp(.12 / Math.max(.025, clips[index].averageRms), .55, 2);
      source.connect(gain).connect(audioDestination);
    });
    await audioContext.resume();

    const canvasStream = canvas.captureStream(preset.fps);
    audioDestination.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "video/webm";
    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: preset.bitrate });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => reject(new Error("Falha durante a exportação"));
    });
    recorder.start(500);

    const drawFactoryQuestion = (text: string) => {
      const boxWidth = canvas.width * .86;
      const boxHeight = canvas.height * .25;
      const boxX = (canvas.width - boxWidth) / 2;
      const boxY = canvas.height * .13;
      const headerHeight = boxHeight * .36;
      const radius = canvas.width * .025;
      const fitText = (content: string, maxWidth: number, maxHeight: number, preferredSize: number) => {
        let fontSize = preferredSize;
        let lines: string[] = [];
        while (fontSize >= canvas.width * .026) {
          context.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
          lines = [];
          let line = "";
          content.split(/\s+/).filter(Boolean).forEach((word) => {
            const candidate = line ? `${line} ${word}` : word;
            if (!line || context.measureText(candidate).width <= maxWidth) line = candidate;
            else { lines.push(line); line = word; }
          });
          if (line) lines.push(line);
          if (lines.length * fontSize * 1.15 <= maxHeight) break;
          fontSize -= 2;
        }
        return { fontSize, lines };
      };
      context.save();
      context.shadowColor = "rgba(0,0,0,.36)";
      context.shadowBlur = canvas.width * .025;
      context.shadowOffsetY = canvas.width * .012;
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
      context.fill();
      context.shadowColor = "transparent";
      context.save();
      context.beginPath();
      context.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
      context.clip();
      context.fillStyle = "#26292f";
      context.fillRect(boxX, boxY, boxWidth, headerHeight);
      context.restore();
      const header = fitText("QUAL É A SUA OPINIÃO?", boxWidth * .84, headerHeight * .72, canvas.width * .044);
      const answer = fitText(text || "Trecho escolhido do corpo do vídeo", boxWidth * .84, (boxHeight - headerHeight) * .72, canvas.width * .048);
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#ffffff";
      context.font = `700 ${header.fontSize}px Arial, Helvetica, sans-serif`;
      header.lines.forEach((line, lineIndex) => context.fillText(line, canvas.width / 2, boxY + headerHeight / 2 + (lineIndex - (header.lines.length - 1) / 2) * header.fontSize * 1.15));
      context.fillStyle = "#292c32";
      context.font = `700 ${answer.fontSize}px Arial, Helvetica, sans-serif`;
      answer.lines.forEach((line, lineIndex) => context.fillText(line, canvas.width / 2, boxY + headerHeight + (boxHeight - headerHeight) / 2 + (lineIndex - (answer.lines.length - 1) / 2) * answer.fontSize * 1.15));
      context.restore();
    };

    for (let index = 0; index < videos.length; index++) {
      const video = videos[index];
      const clip = clips[index];
      const clipStart = clip.sourceStart ?? 0;
      const naturalEnd = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (clip.sourceEnd ?? clip.duration);
      const clipEnd = Math.min(naturalEnd, clip.sourceEnd ?? naturalEnd);
      video.currentTime = clipStart;
      if (factoryStyle === "cinematic" && index > 0) {
        const effect = audioContext.createBufferSource();
        effect.buffer = createSoundEffectBuffer(audioContext, index === 1 ? "whoosh" : "impact");
        effect.connect(audioDestination);
        effect.start();
      }
      await video.play();
      await new Promise<void>((resolve) => {
        const drawFrame = () => {
          const removed = clip.silentRanges.find((range) => video.currentTime >= range.start && video.currentTime < range.end);
          if (removed) video.currentTime = Math.min(video.duration, removed.end);
          context.save();
          context.fillStyle = "#090a0d";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const hookFormat = index === 0 ? clip.hookFormat || "standard" : "standard";
          if (index === 0 && hookFormat === "react") {
            context.filter = "brightness(.68) saturate(.88)";
            drawCover(context, supportVideo || video, canvas.width, canvas.height);
            context.filter = "none";
            const insetWidth = canvas.width * .52;
            const insetHeight = canvas.height * .39;
            const insetX = canvas.width * .035;
            const insetY = canvas.height - insetHeight - canvas.height * .055;
            context.save();
            context.shadowColor = "rgba(0,0,0,.55)";
            context.shadowBlur = canvas.width * .025;
            context.beginPath();
            context.roundRect(insetX, insetY, insetWidth, insetHeight, canvas.width * .035);
            context.clip();
            drawCoverInRect(context, video, insetX, insetY, insetWidth, insetHeight);
            context.restore();
            context.fillStyle = "#d9ff69";
            context.font = `900 ${canvas.width * .027}px Arial, sans-serif`;
            context.textAlign = "left";
            context.fillText("REACT", insetX + canvas.width * .025, insetY + canvas.width * .045);
          } else if (index === 0 && hookFormat === "split") {
            const topHeight = Math.round(canvas.height * .56);
            drawCoverInRect(context, supportVideo || video, 0, 0, canvas.width, topHeight);
            drawCoverInRect(context, video, 0, topHeight, canvas.width, canvas.height - topHeight);
            const gradient = context.createLinearGradient(0, topHeight - 35, 0, topHeight + 35);
            gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(.5, "rgba(0,0,0,.72)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
            context.fillStyle = gradient;
            context.fillRect(0, topHeight - 35, canvas.width, 70);
          } else if (index === 0 && hookFormat === "question") {
            drawCover(context, video, canvas.width, canvas.height);
            drawFactoryQuestion(clip.sourceText || "Trecho escolhido do corpo do vídeo");
          } else if (factoryStyle === "split") {
            const topHeight = Math.round(canvas.height * .56);
            drawCoverInRect(context, video, 0, 0, canvas.width, topHeight);
            drawCoverInRect(context, supportVideo || video, 0, topHeight, canvas.width, canvas.height - topHeight);
            const gradient = context.createLinearGradient(0, topHeight - 35, 0, topHeight + 35);
            gradient.addColorStop(0, "rgba(0,0,0,0)"); gradient.addColorStop(.5, "rgba(0,0,0,.72)"); gradient.addColorStop(1, "rgba(0,0,0,0)");
            context.fillStyle = gradient;
            context.fillRect(0, topHeight - 35, canvas.width, 70);
          } else if (factoryStyle === "cinematic") {
            const progress = video.duration ? video.currentTime / video.duration : 0;
            const scale = 1 + progress * .035;
            context.translate(canvas.width / 2, canvas.height / 2);
            context.scale(scale, scale);
            context.translate(-canvas.width / 2, -canvas.height / 2);
            context.filter = "contrast(1.05) saturate(1.08)";
            drawCover(context, video, canvas.width, canvas.height);
            context.filter = "none";
          } else {
            drawCover(context, video, canvas.width, canvas.height);
          }
          const shade = context.createLinearGradient(0, 0, 0, canvas.height);
          shade.addColorStop(0, "rgba(0,0,0,.10)"); shade.addColorStop(.5, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.18)");
          context.fillStyle = shade; context.fillRect(0, 0, canvas.width, canvas.height);
          context.restore();
          if (video.ended || video.currentTime >= clipEnd - .025) resolve();
          else requestAnimationFrame(drawFrame);
        };
        requestAnimationFrame(drawFrame);
      });
      video.pause();
    }
    recorder.stop();
    const blob = await completed;
    supportVideo?.pause();
    videos.forEach((video) => { video.pause(); video.removeAttribute("src"); });
    await audioContext.close();
    canvasStream.getTracks().forEach((track) => track.stop());
    return blob;
  }

  async function openFactoryProjectInEditor(projectId: string) {
    const project = factoryProjects.find((item) => item.id === projectId);
    const variant = project ? factoryVariants.find((item) => item.id === project.variantId) : undefined;
    if (!project || !variant || factoryPreparing) return;
    setFactoryPreparing(true);
    setFactoryExportStatus(`Preparando “${project.name}” para edição`);
    try {
      const sequence = (project.clips || [variant.hook, variant.body, variant.cta]).map((clip) => ({ ...clip, silentRanges: clip.silentRanges.map((range) => ({ ...range })) })) as [FactoryClip, FactoryClip, FactoryClip];
      const editableVariant: FactoryVariant = { ...variant, hook: sequence[0], body: sequence[1], cta: sequence[2], duration: sequence.reduce((total, clip) => total + Math.max(.1, clip.duration - clip.removedSeconds), 0) };
      const blob = await renderFactoryVariant(editableVariant);
      const safeName = (project.name.trim() || "conteudo").replace(/[\\/:*?"<>|]+/g, "-");
      const file = new File([blob], `${safeName}.webm`, { type: blob.type || "video/webm" });
      let cleanCursor = 0;
      const removedRanges: FactoryRemovedRange[] = [];
      const structureRanges: FactoryStructureRange[] = [];
      sequence.forEach((clip) => {
        const sectionStart = cleanCursor;
        const sourceOrigin = clip.sourceStart ?? 0;
        let removedBefore = 0;
        clip.silentRanges.forEach((range) => {
          removedRanges.push({
            at: cleanCursor + Math.max(0, range.start - sourceOrigin - removedBefore),
            duration: range.end - range.start,
            section: clip.section,
            sourceStart: range.start,
            sourceEnd: range.end,
          });
          removedBefore += range.end - range.start;
        });
        cleanCursor += Math.max(0, clip.duration - clip.removedSeconds);
        structureRanges.push({ section: clip.section, start: sectionStart, end: cleanCursor });
      });
      setBrollClips((current) => {
        current.forEach((clip) => URL.revokeObjectURL(clip.url));
        return [];
      });
      chooseVideo(file, { duration: editableVariant.duration, removedRanges, structureRanges });
      setActiveFactorySequence(sequence);
      setActiveFactoryProjectId(project.id);
      patchFactoryProject(project.id, { status: "adjusting" });
      const emptyProducts = DEFAULT_SETTINGS.products.map((item, index) => ({ ...item, name: `Imagem ${index + 1}`, label: "" }));
      setTemplateMode("free");
      setExtraTextLayers([]);
      setSettings({ ...DEFAULT_SETTINGS, title: "", category: "", products: emptyProducts });
      setProducts(emptyProducts);
      setCanvasLayouts(FREE_CANVAS_LAYOUTS);
      setSelectedElement(null);
      setActivePanel("edit");
      setToast(`${project.name} aberto no editor`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível abrir esta variação");
    } finally {
      setFactoryPreparing(false);
      setFactoryExportStatus("");
    }
  }

  async function exportFactorySelection() {
    const selected = factoryVariants.filter((variant) => factorySelectedIds.includes(variant.id));
    if (!selected.length || factoryExporting) {
      if (!selected.length) setToast("Selecione pelo menos uma combinação");
      return;
    }
    setFactoryExporting(true);
    setFactoryExportProgress(0);
    try {
      for (let index = 0; index < selected.length; index++) {
        const variant = selected[index];
        setFactoryExportStatus(`Montando vídeo ${index + 1} de ${selected.length}`);
        const blob = await renderFactoryVariant(variant);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const hookIndex = factoryClips.hook.findIndex((clip) => clip.id === variant.hook.id) + 1;
        const bodyIndex = factoryClips.body.findIndex((clip) => clip.id === variant.body.id) + 1;
        const ctaIndex = factoryClips.cta.findIndex((clip) => clip.id === variant.cta.id) + 1;
        link.download = `clippronto-H${hookIndex}-C${bodyIndex}-CTA${ctaIndex}-${factoryStyle}-${EXPORT_PRESETS[exportPresetId].name.toLowerCase().replaceAll(" ", "-")}.webm`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        setFactoryExportProgress(Math.round(((index + 1) / selected.length) * 100));
      }
      setToast(`${selected.length} vídeo${selected.length > 1 ? "s" : ""} exportado${selected.length > 1 ? "s" : ""}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Não foi possível concluir a exportação");
    } finally {
      setFactoryExporting(false);
      setFactoryExportStatus("");
    }
  }

  async function analyzeSilence() {
    if (!videoFile) {
      setToast("Carregue um vídeo primeiro");
      return;
    }
    setAnalysisStatus("working");
    setAnalysisError("");
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextClass();
      const buffer = await context.decodeAudioData(await videoFile.arrayBuffer());
      const sampleRate = buffer.sampleRate;
      const windowSize = Math.max(1, Math.round(sampleRate * 0.025));
      const threshold = Math.pow(10, settings.thresholdDb / 20);
      const channelData = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
      const raw: SilentRange[] = [];
      let silenceStart: number | null = null;

      for (let offset = 0; offset < buffer.length; offset += windowSize) {
        const end = Math.min(buffer.length, offset + windowSize);
        let squares = 0;
        let count = 0;
        for (const channel of channelData) {
          for (let sample = offset; sample < end; sample += 2) {
            squares += channel[sample] * channel[sample];
            count++;
          }
        }
        const rms = Math.sqrt(squares / Math.max(1, count));
        const time = offset / sampleRate;
        if (rms <= threshold && silenceStart === null) silenceStart = time;
        if (rms > threshold && silenceStart !== null) {
          if (time - silenceStart >= settings.minimumSilence) raw.push({ start: silenceStart, end: time });
          silenceStart = null;
        }
      }
      if (silenceStart !== null) {
        const end = buffer.duration;
        if (end - silenceStart >= settings.minimumSilence) raw.push({ start: silenceStart, end });
      }
      const padded = raw
        .map(({ start, end }) => ({ start: start + settings.padding, end: end - settings.padding, origin: "automatic" as const }))
        .filter((range) => range.end - range.start > 0.08);
      setCutHistory((history) => [...history.slice(-19), silentRanges]);
      setSilentRanges(padded);
      setSelectedCut(padded.length ? 0 : null);
      setAnalysisStatus("done");
      patchSettings({ removeSilence: padded.length > 0 });
      if (videoRef.current) videoRef.current.currentTime = 0;
      await context.close();
      setToast(padded.length > 0
        ? `Edição automática aplicada: ${padded.length} pausas removidas`
        : "Análise concluída: nenhuma pausa longa encontrada");
    } catch {
      setAnalysisStatus("error");
      setAnalysisError("O navegador não conseguiu ler o áudio deste arquivo. Tente um MP4 com áudio AAC.");
    }
  }

  async function transcribeVideoLocally() {
    if (!videoFile) {
      setToast("Adicione um vídeo antes de transcrever");
      return;
    }
    setTranscriptionStatus("loading");
    setTranscriptionProgress(1);
    setTranscriptionError("");
    setTranscriptText("");
    setTranscriptChunks([]);
    let audioContext: AudioContext | null = null;
    try {
      const transformers = await import("@huggingface/transformers");
      transformers.env.useBrowserCache = true;
      transformers.env.allowLocalModels = false;
      const supportsWebGpu = "gpu" in navigator;
      const modelId = whisperQuality === "accurate"
        ? "onnx-community/whisper-small"
        : "onnx-community/whisper-base";
      const transcriber = await transformers.pipeline(
        "automatic-speech-recognition",
        modelId,
        {
          device: supportsWebGpu ? "webgpu" : "wasm",
          dtype: supportsWebGpu ? "fp16" : "q8",
          progress_callback: (progress: { status?: string; progress?: number }) => {
            if (progress.status === "progress" && Number.isFinite(progress.progress)) {
              setTranscriptionProgress(Math.max(2, Math.min(72, Math.round(progress.progress! * .72))));
            }
          },
        },
      );

      setTranscriptionStatus("transcribing");
      setTranscriptionProgress(76);
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioContextClass();
      const decoded = await audioContext.decodeAudioData(await videoFile.arrayBuffer());
      const targetRate = 16_000;
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const audio = new Float32Array(rendered.getChannelData(0));
      const rawResult = await transcriber(audio, {
        language: "portuguese",
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 6,
        return_timestamps: true,
      }) as unknown as { text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number | null] }> };
      const chunks = (rawResult.chunks || []).map((chunk) => ({
        text: (chunk.text || "").trim(),
        timestamp: chunk.timestamp || [0, null],
      })).filter((chunk) => chunk.text);
      setTranscriptText((rawResult.text || chunks.map((chunk) => chunk.text).join(" ")).trim());
      setTranscriptChunks(chunks);
      setTranscriptionProgress(100);
      setTranscriptionStatus("done");
      setToast("Transcrição local concluída");
    } catch (error) {
      console.error("Falha na transcrição local", error);
      setTranscriptionStatus("error");
      setTranscriptionError(whisperQuality === "accurate"
        ? "O modo de alta precisão exige mais memória. Tente o modo Equilibrado ou use um vídeo menor. No primeiro uso, verifique também a conexão."
        : "Não foi possível transcrever neste navegador. Verifique a conexão do primeiro carregamento ou tente um vídeo menor.");
    } finally {
      if (audioContext) await audioContext.close().catch(() => undefined);
    }
  }

  async function copyTranscript() {
    if (!transcriptText) return;
    await navigator.clipboard.writeText(transcriptText);
    setToast("Transcrição copiada");
  }

  function downloadTranscriptSrt() {
    if (!transcriptChunks.length) return;
    const srtTime = (seconds: number | null) => {
      const value = Math.max(0, seconds || 0);
      const hours = Math.floor(value / 3600).toString().padStart(2, "0");
      const minutes = Math.floor((value % 3600) / 60).toString().padStart(2, "0");
      const wholeSeconds = Math.floor(value % 60).toString().padStart(2, "0");
      const milliseconds = Math.floor((value % 1) * 1000).toString().padStart(3, "0");
      return `${hours}:${minutes}:${wholeSeconds},${milliseconds}`;
    };
    const content = transcriptChunks.map((chunk, index) => {
      const end = chunk.timestamp[1] ?? chunk.timestamp[0] + 2;
      return `${index + 1}\n${srtTime(chunk.timestamp[0])} --> ${srtTime(end)}\n${chunk.text}\n`;
    }).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "application/x-subrip;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${videoFile?.name.replace(/\.[^.]+$/, "") || "legendas"}.srt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function drawCoverInRect(context: CanvasRenderingContext2D, video: HTMLVideoElement, destinationX: number, destinationY: number, width: number, height: number, focus: VideoFocus = { x: 50, y: 50 }, cropZoom = 1) {
    const videoRatio = video.videoWidth / video.videoHeight;
    const canvasRatio = width / height;
    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;
    let sourceX = 0;
    let sourceY = 0;
    if (videoRatio > canvasRatio) {
      sourceWidth = video.videoHeight * canvasRatio;
    } else {
      sourceHeight = video.videoWidth / canvasRatio;
    }
    sourceWidth /= Math.max(1, cropZoom);
    sourceHeight /= Math.max(1, cropZoom);
    sourceX = Math.max(0, Math.min(video.videoWidth - sourceWidth, video.videoWidth * focus.x / 100 - sourceWidth / 2));
    sourceY = Math.max(0, Math.min(video.videoHeight - sourceHeight, video.videoHeight * focus.y / 100 - sourceHeight / 2));
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, width, height);
  }

  function drawCover(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number, focus: VideoFocus = { x: 50, y: 50 }, cropZoom = 1) {
    drawCoverInRect(context, video, 0, 0, width, height, focus, cropZoom);
  }

  function styledCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle, forceCenter = false) {
    const renderedText = style.uppercase ? text.toUpperCase() : text;
    const lines = renderedText.split(/\r?\n/);
    const alignment = forceCenter ? "center" : style.align;
    const resolutionScale = context.canvas.width / 1080;
    const fontSize = style.fontSize * resolutionScale;
    const strokeWidth = style.strokeWidth * resolutionScale;
    const letterSpacing = style.letterSpacing * resolutionScale;
    const lineHeight = fontSize * 1.08;
    const firstLineY = y - (lines.length - 1) * lineHeight / 2;
    const finalX = alignment === "left" ? 60 * resolutionScale : alignment === "right" ? context.canvas.width - 60 * resolutionScale : x;
    context.save();
    context.textAlign = alignment;
    context.textBaseline = "middle";
    context.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${fontSize}px "${style.fontFamily}", sans-serif`;
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
    context.lineJoin = "round";
    if (style.background !== "transparent") {
      const blockWidth = Math.max(...lines.map((line) => context.measureText(line).width));
      const paddingX = 28 * resolutionScale;
      const paddingY = 15 * resolutionScale;
      const startX = alignment === "center" ? finalX - blockWidth / 2 : alignment === "right" ? finalX - blockWidth : finalX;
      context.fillStyle = style.background;
      context.beginPath();
      context.roundRect(startX - paddingX, firstLineY - fontSize / 2 - paddingY, blockWidth + paddingX * 2, fontSize + (lines.length - 1) * lineHeight + paddingY * 2, 18 * resolutionScale);
      context.fill();
    }
    if (style.shadow) {
      context.shadowColor = "rgba(0,0,0,.55)";
      context.shadowBlur = 18 * resolutionScale;
      context.shadowOffsetY = 8 * resolutionScale;
    }
    lines.forEach((line, index) => {
      const lineY = firstLineY + index * lineHeight;
      if (strokeWidth > 0) {
        context.lineWidth = strokeWidth;
        context.strokeStyle = style.strokeColor;
        context.strokeText(line, finalX, lineY);
      }
      context.fillStyle = style.color;
      context.fillText(line, finalX, lineY);
      if (style.underline) {
        const metrics = context.measureText(line);
        const startX = alignment === "center" ? finalX - metrics.width / 2 : alignment === "right" ? finalX - metrics.width : finalX;
        context.fillRect(startX, lineY + fontSize * .58, metrics.width, Math.max(3 * resolutionScale, fontSize * .055));
      }
    });
    context.restore();
  }

  async function exportVideo(superClip?: SuperClip) {
    const video = videoRef.current;
    if (!video || !videoFile || !video.videoWidth) {
      if (superClip) throw new Error(`A cena "${superClip.sceneLabel}" precisa de um vídeo`);
      setToast("Carregue um vídeo antes de exportar");
      return;
    }
    if (!superClip && templateMode === "react" && reactRemoveBackground && reactSegmentationStatus !== "ready") {
      setToast(reactSegmentationStatus === "error" ? "Ajuste o recorte ou desative o fundo transparente antes de exportar" : "Aguarde o recorte transparente ficar pronto");
      return;
    }
    if (!("MediaRecorder" in window)) {
      if (superClip) throw new Error("Este navegador não oferece exportação local");
      setToast("Este navegador não oferece exportação local");
      return;
    }
    if (!superClip) {
      setExporting(true);
      setShowExportDialog(false);
      setExportProgress(0);
    }
    const exportPreset = superClip ? superClip.preset : EXPORT_PRESETS[exportPresetId];
    await Promise.all([...Object.values(settings.textStyles), ...extraTextLayers.map((layer) => layer.style)].map((style) =>
      document.fonts.load(`${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`),
    ));
    const canvas = superClip ? superClip.canvas : document.createElement("canvas");
    if (!superClip) {
      canvas.width = exportPreset.width;
      canvas.height = exportPreset.height;
    }
    const context = superClip ? superClip.context : canvas.getContext("2d")!;
    const compositionCanvas = superClip ? superClip.compositionCanvas : document.createElement("canvas");
    if (!superClip) {
      compositionCanvas.width = canvas.width;
      compositionCanvas.height = canvas.height;
    }
    const compositionContext = superClip ? superClip.compositionContext : compositionCanvas.getContext("2d")!;
    const drawCinematicBroll = (auxiliaryVideo: HTMLVideoElement, focus: VideoFocus, clip: BrollClip) => {
      if (clip.placement === "overlay") {
        const requestedWidth = canvas.width * (clip.overlayWidth ?? 40) / 100;
        const overlayWidth = Math.min(canvas.width * .82, requestedWidth);
        const overlayHeight = Math.min(canvas.height * .74, overlayWidth * 16 / 9);
        const overlayX = clamp(canvas.width * (clip.overlayX ?? 54) / 100, 0, canvas.width - overlayWidth);
        const overlayY = clamp(canvas.height * (clip.overlayY ?? 8) / 100, 0, canvas.height - overlayHeight);
        const radius = canvas.width * .025;
        context.save();
        context.beginPath();
        context.roundRect(overlayX, overlayY, overlayWidth, overlayHeight, radius);
        context.clip();
        drawCoverInRect(context, auxiliaryVideo, overlayX, overlayY, overlayWidth, overlayHeight, focus);
        context.restore();
        context.save();
        context.strokeStyle = "rgba(255,255,255,.82)";
        context.lineWidth = Math.max(2, canvas.width * .003);
        context.beginPath();
        context.roundRect(overlayX, overlayY, overlayWidth, overlayHeight, radius);
        context.stroke();
        context.restore();
        return;
      }
      if (cinematicLayout === "replace") {
        drawCover(context, auxiliaryVideo, canvas.width, canvas.height, focus);
        return;
      }
      const boundary = (splitDirection === "horizontal" ? canvas.height : canvas.width) * splitPosition / 100;
      if (cinematicLayout === "split-bar") {
        if (splitDirection === "horizontal") {
          if (brollPlacement === "first") {
            drawCoverInRect(context, auxiliaryVideo, 0, 0, canvas.width, boundary, focus);
            drawCoverInRect(context, video, 0, boundary, canvas.width, canvas.height - boundary, mainCrop, mainCrop.zoom);
          } else {
            drawCoverInRect(context, video, 0, 0, canvas.width, boundary, mainCrop, mainCrop.zoom);
            drawCoverInRect(context, auxiliaryVideo, 0, boundary, canvas.width, canvas.height - boundary, focus);
          }
        } else if (brollPlacement === "first") {
          drawCoverInRect(context, auxiliaryVideo, 0, 0, boundary, canvas.height, focus);
          drawCoverInRect(context, video, boundary, 0, canvas.width - boundary, canvas.height, mainCrop, mainCrop.zoom);
        } else {
          drawCoverInRect(context, video, 0, 0, boundary, canvas.height, mainCrop, mainCrop.zoom);
          drawCoverInRect(context, auxiliaryVideo, boundary, 0, canvas.width - boundary, canvas.height, focus);
        }
        const barSize = splitBarSize * canvas.width / 1080;
        context.fillStyle = splitBarColor;
        if (splitDirection === "horizontal") context.fillRect(0, boundary - barSize / 2, canvas.width, barSize);
        else context.fillRect(boundary - barSize / 2, 0, barSize, canvas.height);
        return;
      }
      compositionContext.globalCompositeOperation = "source-over";
      compositionContext.clearRect(0, 0, compositionCanvas.width, compositionCanvas.height);
      drawCover(compositionContext, auxiliaryVideo, compositionCanvas.width, compositionCanvas.height, focus);
      compositionContext.globalCompositeOperation = "destination-in";
      const feather = (splitDirection === "horizontal" ? canvas.height : canvas.width) * .12;
      const gradient = splitDirection === "horizontal"
        ? compositionContext.createLinearGradient(0, boundary - feather, 0, boundary + feather)
        : compositionContext.createLinearGradient(boundary - feather, 0, boundary + feather, 0);
      gradient.addColorStop(0, brollPlacement === "first" ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
      gradient.addColorStop(1, brollPlacement === "first" ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
      compositionContext.fillStyle = gradient;
      compositionContext.fillRect(0, 0, compositionCanvas.width, compositionCanvas.height);
      compositionContext.globalCompositeOperation = "source-over";
      context.drawImage(compositionCanvas, 0, 0);
    };
    const images = await Promise.all(products.map(async (product) => {
      if (!product.url) return null;
      const image = new Image();
      image.src = product.url;
      await image.decode();
      return image;
    }));
    let watermarkImage: HTMLImageElement | null = null;
    if (watermarkEnabled && watermarkPhotoUrl) {
      watermarkImage = new Image();
      watermarkImage.src = watermarkPhotoUrl;
      try { await watermarkImage.decode(); } catch { watermarkImage = null; }
    }
    const drawWatermark = () => {
      if (!watermarkEnabled) return;
      const base = canvas.width * (watermarkLayout.width / 100) * .15;
      const m = watermarkMetrics(base, watermarkFormat);
      const dark = watermarkTheme === "dark";
      const nameColor = dark ? "#0f1114" : "#ffffff";
      const handleColor = dark ? "#5b6470" : "#e7eaef";
      const shadowColor = dark ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.55)";
      const nameFontStr = `800 ${m.name}px Arial, Helvetica, sans-serif`;
      const handleFontStr = `600 ${m.handle}px Arial, Helvetica, sans-serif`;
      const name = watermarkName || "Seu Nome";
      const handle = watermarkHandle || "@seuusuario";
      const cx = canvas.width * watermarkLayout.x / 100;
      const cy = canvas.height * watermarkLayout.y / 100;
      const badgeGap = watermarkVerified ? m.name * .16 : 0;
      const drawPhoto = (leftX: number, centerY: number) => {
        const r = m.photo / 2;
        context.save();
        context.beginPath();
        context.arc(leftX + r, centerY, r, 0, Math.PI * 2);
        context.closePath();
        if (watermarkImage) {
          context.clip();
          const scale = Math.max(m.photo / watermarkImage.width, m.photo / watermarkImage.height);
          const w = watermarkImage.width * scale;
          const h = watermarkImage.height * scale;
          context.drawImage(watermarkImage, leftX + r - w / 2, centerY - h / 2, w, h);
        } else {
          context.fillStyle = dark ? "#d7dbe2" : "rgba(255,255,255,.22)";
          context.fill();
        }
        context.restore();
        context.save();
        context.beginPath();
        context.arc(leftX + r, centerY, r, 0, Math.PI * 2);
        context.lineWidth = Math.max(1, m.photo * .05);
        context.strokeStyle = dark ? "#ffffff" : "rgba(255,255,255,.9)";
        context.stroke();
        context.restore();
      };
      const drawBadge = (centerX: number, centerY: number, size: number) => {
        context.save();
        context.translate(centerX - size / 2, centerY - size / 2);
        context.scale(size / 24, size / 24);
        context.fillStyle = "#1d9bf0";
        context.fill(new Path2D(VERIFIED_SEAL_PATH));
        context.fillStyle = "#ffffff";
        context.fill(new Path2D(VERIFIED_CHECK_PATH));
        context.restore();
      };
      const drawLabel = (text: string, x: number, y: number, font: string, color: string) => {
        context.font = font;
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.shadowColor = shadowColor;
        context.shadowBlur = base * .22;
        context.shadowOffsetY = base * .04;
        context.fillStyle = color;
        context.fillText(text, x, y);
        context.shadowColor = "transparent";
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
      };
      context.save();
      context.globalAlpha = watermarkOpacity;
      if (watermarkFormat === "full") {
        context.font = nameFontStr;
        const nameW = context.measureText(name).width;
        context.font = handleFontStr;
        const handleW = context.measureText(handle).width;
        const handleRowW = handleW + (watermarkVerified ? badgeGap + m.badge : 0);
        const textW = Math.max(nameW, handleRowW);
        const contentW = m.photo + m.gap + textW;
        const contentH = Math.max(m.photo, m.name + m.lineGap + m.handle * 1.25);
        const startX = cx - contentW / 2;
        const top = cy - contentH / 2;
        drawPhoto(startX, cy);
        const textX = startX + m.photo + m.gap;
        drawLabel(name, textX, top + m.name * .55, nameFontStr, nameColor);
        const handleY = top + m.name + m.lineGap + m.handle * .62;
        drawLabel(handle, textX, handleY, handleFontStr, handleColor);
        if (watermarkVerified) drawBadge(textX + handleW + badgeGap + m.badge / 2, handleY, m.badge);
      } else {
        context.font = nameFontStr;
        const nameW = context.measureText(name).width;
        const rowW = nameW + (watermarkVerified ? badgeGap + m.badge : 0);
        const contentW = m.photo + m.gap + rowW;
        const startX = cx - contentW / 2;
        drawPhoto(startX, cy);
        const textX = startX + m.photo + m.gap;
        drawLabel(name, textX, cy, nameFontStr, nameColor);
        if (watermarkVerified) drawBadge(textX + nameW + badgeGap + m.badge / 2, cy, m.badge);
      }
      context.restore();
    };
    let reactExportImage: HTMLImageElement | null = null;
    let reactExportVideo: HTMLVideoElement | null = null;
    if (templateMode === "react" && reactMediaUrl) {
      if (reactMediaType === "image") {
        reactExportImage = new Image();
        reactExportImage.src = reactMediaUrl;
        await reactExportImage.decode();
      } else {
        reactExportVideo = document.createElement("video");
        reactExportVideo.src = reactMediaUrl;
        reactExportVideo.muted = true;
        reactExportVideo.loop = true;
        reactExportVideo.playsInline = true;
        await new Promise<void>((resolve, reject) => {
          reactExportVideo!.onloadeddata = () => resolve();
          reactExportVideo!.onerror = () => reject(new Error("Não foi possível preparar o vídeo de fundo do React"));
        });
        await reactExportVideo.play().catch(() => undefined);
      }
    }
    const drawReactBackground = (source: HTMLImageElement | HTMLVideoElement) => {
      const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
      const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
      const scale = Math.max(canvas.width / Math.max(1, sourceWidth), canvas.height / Math.max(1, sourceHeight));
      const width = sourceWidth * scale;
      const height = sourceHeight * scale;
      context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    };
    const drawTimedRanking = (time: number) => {
      const count = rankingSettings.count;
      const isBottom = rankingSettings.position === "bottom";
      const sideWidth = canvas.width * .43;
      const top = canvas.height * .27;
      const availableHeight = canvas.height * .56;
      const gap = rankingSettings.numberSpacing * canvas.width / 100;
      const rowHeight = Math.max(canvas.height * .018, (availableHeight - gap * Math.max(0, count - 1)) / count);
      const bottomLeft = canvas.width * .05;
      const bottomWidth = canvas.width * .9;
      const cellWidth = Math.max(canvas.width * .025, (bottomWidth - gap * Math.max(0, count - 1)) / count);
      products.slice(0, count).forEach((product, index) => {
        const visibility = rankingVisibility(time, index, rankingSettings);
        if (visibility <= 0) return;
        const numberProgress = rankingPartProgress(time, index, rankingSettings, "number");
        const mediaProgress = rankingPartProgress(time, index, rankingSettings, "media");
        const numberFrame = rankingMotionFrame(rankingSettings.motion, numberProgress, rankingSettings.position);
        const mediaFrame = rankingMotionFrame(rankingSettings.motion, mediaProgress, rankingSettings.position);
        const baseX = isBottom
          ? bottomLeft + index * (cellWidth + gap) + cellWidth / 2
          : rankingSettings.position === "right" ? canvas.width * .765 : canvas.width * .235;
        const baseY = isBottom ? canvas.height * .77 : top + index * (rowHeight + gap) + rowHeight / 2;
        const motionWidth = isBottom ? cellWidth : sideWidth;
        const numberSize = isBottom
          ? Math.min(canvas.width * .055, cellWidth * .58)
          : Math.min(canvas.width * .083, rowHeight * .58);
        const numberX = isBottom ? 0 : -sideWidth * .38;
        const numberY = isBottom ? -canvas.height * .055 : 0;
        if (numberProgress > 0) {
          context.save();
          context.globalAlpha = numberFrame.opacity * visibility;
          context.translate(baseX + numberFrame.x / 100 * motionWidth, baseY + numberFrame.y / 100 * rowHeight);
          context.rotate(numberFrame.rotate * Math.PI / 180);
          context.scale(numberFrame.scale, numberFrame.scale);
          context.font = `950 ${numberSize}px "Montserrat Local", sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.lineJoin = "round";
          context.lineWidth = Math.max(3, numberSize * .16);
          context.strokeStyle = "rgba(5,5,5,.94)";
          context.fillStyle = "#ffffff";
          context.strokeText(`${index + 1}–`, numberX, numberY);
          context.fillText(`${index + 1}–`, numberX, numberY);
          context.restore();
        }
        const image = images[index];
        if (mediaProgress > 0 && (image || product.label)) {
          context.save();
          context.globalAlpha = mediaFrame.opacity * visibility;
          context.translate(baseX + mediaFrame.x / 100 * motionWidth, baseY + mediaFrame.y / 100 * rowHeight);
          context.rotate(mediaFrame.rotate * Math.PI / 180);
          context.scale(mediaFrame.scale * (rankingSettings.itemScales[index] ?? 1), mediaFrame.scale * (rankingSettings.itemScales[index] ?? 1));
        }
        if (mediaProgress > 0 && image) {
          const maxWidth = isBottom ? cellWidth * .86 : sideWidth * .64;
          const maxHeight = isBottom ? canvas.height * .12 : rowHeight * .94;
          const imageScale = Math.min(maxWidth / image.width, maxHeight / image.height);
          const width = image.width * imageScale;
          const height = image.height * imageScale;
          const imageX = isBottom ? -width / 2 : sideWidth * .09 - width / 2;
          const imageY = isBottom ? -height * .08 : -height / 2;
          context.shadowColor = "rgba(0,0,0,.3)";
          context.shadowBlur = canvas.width * .012;
          context.shadowOffsetY = canvas.width * .006;
          context.drawImage(image, imageX, imageY, width, height);
        }
        if (mediaProgress > 0 && product.label) {
          context.shadowColor = "rgba(0,0,0,.7)";
          context.shadowBlur = 7 * canvas.width / 1080;
          context.font = `850 ${Math.max(14, numberSize * .34)}px "Montserrat Local", sans-serif`;
          context.fillStyle = "#ffffff";
          const labelX = isBottom ? 0 : sideWidth * .1;
          const labelY = isBottom ? canvas.height * .07 : rowHeight * .32;
          context.fillText(product.label, labelX, labelY, isBottom ? cellWidth * .9 : sideWidth * .62);
        }
        if (mediaProgress > 0 && (image || product.label)) context.restore();
      });
    };
    const wrapQuestionText = (text: string, maxWidth: number, fontSize: number) => {
      context.font = `400 ${fontSize}px Arial, Helvetica, sans-serif`;
      const lines: string[] = [];
      (text || " ").split(/\r?\n/).forEach((paragraph) => {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return lines.push(" ");
        let line = words[0];
        words.slice(1).forEach((word) => {
          const candidate = `${line} ${word}`;
          if (context.measureText(candidate).width <= maxWidth) line = candidate;
          else { lines.push(line); line = word; }
        });
        lines.push(line);
      });
      return lines;
    };
    const drawQuestionText = (text: string, x: number, y: number, width: number, height: number, color: string) => {
      let fontSize = Math.min(width * .057, height * .38);
      let lines = wrapQuestionText(text, width * .9, fontSize);
      while (fontSize > width * .025 && lines.length * fontSize * 1.12 > height * .78) {
        fontSize -= 2;
        lines = wrapQuestionText(text, width * .9, fontSize);
      }
      context.save();
      context.fillStyle = color;
      context.font = `400 ${fontSize}px Arial, Helvetica, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const lineHeight = fontSize * 1.12;
      const firstY = y + height / 2 - (lines.length - 1) * lineHeight / 2;
      lines.forEach((line, index) => context.fillText(line, x + width / 2, firstY + index * lineHeight));
      context.restore();
    };
    const drawQuestionBox = () => {
      const layout = canvasLayouts["question-box"] || { x: 50, y: 27, width: 91 };
      const width = canvas.width * layout.width / 100;
      const height = width / 2.248;
      const x = canvas.width * layout.x / 100 - width / 2;
      const y = canvas.height * layout.y / 100 - height / 2;
      const scale = canvas.width / 1080;
      const borderWidth = questionBox.borderEnabled ? questionBox.borderWidth * scale : 0;
      const radius = questionBox.borderRadius * scale;
      const innerX = x + borderWidth;
      const innerY = y + borderWidth;
      const innerWidth = Math.max(1, width - borderWidth * 2);
      const innerHeight = Math.max(1, height - borderWidth * 2);
      const promptHeight = innerHeight * .447;
      context.save();
      context.shadowColor = "rgba(0,0,0,.28)";
      context.shadowBlur = canvas.width * .025;
      context.shadowOffsetY = canvas.width * .012;
      context.fillStyle = questionBox.borderEnabled ? questionBox.borderColor : "#ffffff";
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.fill();
      context.shadowColor = "transparent";
      context.beginPath();
      context.roundRect(innerX, innerY, innerWidth, innerHeight, Math.max(0, radius - borderWidth));
      context.clip();
      context.fillStyle = "#ffffff";
      context.fillRect(innerX, innerY, innerWidth, innerHeight);
      context.fillStyle = "#24272d";
      context.fillRect(innerX, innerY, innerWidth, promptHeight);
      drawQuestionText(questionBox.prompt, innerX, innerY, innerWidth, promptHeight, "#ffffff");
      drawQuestionText(questionBox.answer, innerX, innerY + promptHeight, innerWidth, innerHeight - promptHeight, "#292c32");
      context.restore();
    };
    const exportBrollVideos = await Promise.all(overlayVideoClips.map(async (clip) => {
      const auxiliaryVideo = document.createElement("video");
      auxiliaryVideo.src = clip.url;
      auxiliaryVideo.muted = true;
      auxiliaryVideo.playsInline = true;
      auxiliaryVideo.preload = "auto";
      await new Promise<void>((resolve, reject) => {
        auxiliaryVideo.onloadeddata = () => resolve();
        auxiliaryVideo.onerror = () => reject(new Error(`Não foi possível preparar ${clip.name}`));
      });
      auxiliaryVideo.currentTime = clip.sourceStart;
      return { clip, video: auxiliaryVideo };
    }));

    const canvasStream = superClip ? null : canvas.captureStream(exportPreset.fps);
    const captureVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; webkitCaptureStream?: () => MediaStream };
    const sourceStream = captureVideo.captureStream?.() || captureVideo.webkitCaptureStream?.();
    const removedBefore = (time: number) => settings.removeSilence
      ? silentRanges.reduce((total, range) => total + (range.start >= time ? 0 : Math.max(0, Math.min(time, range.end) - range.start)), 0)
      : 0;
    let exportAudioContext: AudioContext | null = null;
    let startImportedAudio: (() => void) | null = null;
    if (superClip) {
      // This scene's own audio flows into the shared destination; imported audios
      // are global and handled once by the super-content orchestrator.
      exportAudioContext = superClip.audioContext;
      if (!settings.removeAudio && sourceStream?.getAudioTracks().length) {
        superClip.audioContext.createMediaStreamSource(sourceStream).connect(superClip.audioDestination);
      }
      overlayVideoClips.forEach((clip) => {
        const effectSource = superClip.audioContext.createBufferSource();
        const effectGain = superClip.audioContext.createGain();
        effectSource.buffer = createSoundEffectBuffer(superClip.audioContext, clip.sfx);
        effectGain.gain.value = .72;
        effectSource.connect(effectGain).connect(superClip.audioDestination);
        effectSource.start(superClip.audioContext.currentTime + .08 + Math.max(0, clip.timelineStart - removedBefore(clip.timelineStart)));
      });
    } else {
      const audibleImportedAudios = importedAudios.filter((track) => track.volume > 0);
      const hasImportedAudio = audibleImportedAudios.length > 0;
      if ((!settings.removeAudio && sourceStream?.getAudioTracks().length) || overlayVideoClips.length || hasImportedAudio) {
        exportAudioContext = new AudioContext();
        await exportAudioContext.resume();
        const audioDestination = exportAudioContext.createMediaStreamDestination();
        if (!settings.removeAudio && sourceStream?.getAudioTracks().length) {
          exportAudioContext.createMediaStreamSource(sourceStream).connect(audioDestination);
        }
        overlayVideoClips.forEach((clip) => {
          const effectSource = exportAudioContext!.createBufferSource();
          const effectGain = exportAudioContext!.createGain();
          effectSource.buffer = createSoundEffectBuffer(exportAudioContext!, clip.sfx);
          effectGain.gain.value = .72;
          effectSource.connect(effectGain).connect(audioDestination);
          effectSource.start(exportAudioContext!.currentTime + .08 + Math.max(0, clip.timelineStart - removedBefore(clip.timelineStart)));
        });
        if (hasImportedAudio) {
          const starters: Array<{ source: AudioBufferSourceNode; offset: number }> = [];
          for (const track of audibleImportedAudios) {
            try {
              if (!importedAudioBuffersRef.current[track.id]) {
                importedAudioBuffersRef.current[track.id] = await exportAudioContext.decodeAudioData(await track.file.arrayBuffer());
              }
              const musicSource = exportAudioContext.createBufferSource();
              const musicGain = exportAudioContext.createGain();
              musicSource.buffer = importedAudioBuffersRef.current[track.id];
              musicGain.gain.value = track.volume;
              musicSource.connect(musicGain).connect(audioDestination);
              starters.push({ source: musicSource, offset: track.offset });
            } catch {
              setToast(`Não foi possível decodificar o áudio "${track.name}"`);
            }
          }
          startImportedAudio = () => {
            starters.forEach(({ source, offset }) => {
              try { source.start(exportAudioContext!.currentTime + Math.max(0, offset)); } catch { /* already started */ }
            });
          };
        }
        audioDestination.stream.getAudioTracks().forEach((track) => canvasStream!.addTrack(track));
      }
    }
    const mimeCandidates = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
    let recorder: MediaRecorder;
    const chunks: Blob[] = [];
    if (superClip) {
      recorder = superClip.recorder;
    } else {
      const recorderOptions: MediaRecorderOptions = { videoBitsPerSecond: exportPreset.bitrate };
      if (mimeType) recorderOptions.mimeType = mimeType;
      recorder = new MediaRecorder(canvasStream!, recorderOptions);
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    }
    const originalTime = video.currentTime;
    const originalMuted = video.muted;
    const originalPlaybackRate = video.playbackRate;
    const exportMainSegments = orderedVideoSegments.length ? orderedVideoSegments : [{ start: 0, end: video.duration }];
    const exportMainDuration = exportMainSegments.reduce((total, segment) => total + segment.end - segment.start, 0) || video.duration;
    let exportMainIndex = 0;
    video.loop = false;
    video.currentTime = exportMainSegments[0]?.start || 0;
    video.playbackRate = playbackSpeed;
    video.muted = settings.removeAudio;

    await new Promise<void>((resolve, reject) => {
      let raf = 0;
      if (!superClip) {
        recorder.onerror = () => reject(new Error("Falha na gravação"));
        recorder.onstop = () => resolve();
      }
      const render = () => {
        const exportSegment = exportMainSegments[exportMainIndex];
        if (exportSegment && video.currentTime >= exportSegment.end - .025) {
          const nextSegment = exportMainSegments[exportMainIndex + 1];
          if (nextSegment) {
            exportMainIndex += 1;
            video.currentTime = nextSegment.start;
            if (video.paused) video.play().catch(() => undefined);
          } else {
            cancelAnimationFrame(raf);
            reactExportVideo?.pause();
            exportBrollVideos.forEach(({ video: auxiliaryVideo }) => auxiliaryVideo.pause());
            video.pause();
            if (superClip) resolve();
            else if (recorder.state !== "inactive") recorder.stop();
            return;
          }
        }
        if (settings.removeSilence) {
          const range = silentRanges.find((item) => video.currentTime >= item.start && video.currentTime < item.end);
          if (range) video.currentTime = Math.min(range.end, video.duration);
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (templateMode === "react") {
          context.fillStyle = "#15161a";
          context.fillRect(0, 0, canvas.width, canvas.height);
          if (reactExportVideo && reactExportVideo.readyState >= 2) {
            const target = reactExportVideo.duration ? video.currentTime % reactExportVideo.duration : 0;
            if (Math.abs(reactExportVideo.currentTime - target) > .35) reactExportVideo.currentTime = target;
            if (reactExportVideo.paused) reactExportVideo.play().catch(() => undefined);
            drawReactBackground(reactExportVideo);
          } else if (reactExportImage) drawReactBackground(reactExportImage);
          const overlayX = canvas.width * reactLayout.x / 100;
          const overlayY = canvas.height * reactLayout.y / 100;
          const overlayWidth = canvas.width * reactLayout.width / 100;
          const overlayHeight = canvas.height * reactLayout.height / 100;
          const radius = canvas.width * reactLayout.radius / 100;
          const transparentReactSource = reactRemoveBackground && reactSegmentationStatus === "ready" && reactTransparentCanvasRef.current?.width
            ? reactTransparentCanvasRef.current
            : null;
          context.save();
          context.shadowColor = transparentReactSource ? "rgba(0,0,0,.24)" : "rgba(0,0,0,.35)";
          context.shadowBlur = canvas.width * (transparentReactSource ? .01 : .018);
          context.shadowOffsetY = canvas.width * (transparentReactSource ? .004 : .008);
          context.beginPath();
          context.roundRect(overlayX, overlayY, overlayWidth, overlayHeight, radius);
          context.clip();
          if (transparentReactSource) {
            const sourceRatio = transparentReactSource.width / transparentReactSource.height;
            const destinationRatio = overlayWidth / overlayHeight;
            let sourceWidth = transparentReactSource.width;
            let sourceHeight = transparentReactSource.height;
            let sourceX = 0;
            let sourceY = 0;
            if (sourceRatio > destinationRatio) {
              sourceWidth = transparentReactSource.height * destinationRatio;
            } else {
              sourceHeight = transparentReactSource.width / destinationRatio;
            }
            sourceWidth /= mainCrop.zoom;
            sourceHeight /= mainCrop.zoom;
            sourceX = clamp(transparentReactSource.width * mainCrop.x / 100 - sourceWidth / 2, 0, transparentReactSource.width - sourceWidth);
            sourceY = clamp(transparentReactSource.height * mainCrop.y / 100 - sourceHeight / 2, 0, transparentReactSource.height - sourceHeight);
            context.drawImage(transparentReactSource, sourceX, sourceY, sourceWidth, sourceHeight, overlayX, overlayY, overlayWidth, overlayHeight);
          } else drawCoverInRect(context, video, overlayX, overlayY, overlayWidth, overlayHeight, mainCrop, mainCrop.zoom);
          context.restore();
          if (!transparentReactSource) {
            context.save();
            context.strokeStyle = "rgba(255,255,255,.72)";
            context.lineWidth = Math.max(2, canvas.width * .0025);
            context.beginPath();
            context.roundRect(overlayX, overlayY, overlayWidth, overlayHeight, radius);
            context.stroke();
            context.restore();
          }
        } else drawCover(context, video, canvas.width, canvas.height, mainCrop, mainCrop.zoom);
        const activeExportBroll = [...exportBrollVideos]
          .sort((a, b) => (b.clip.layer ?? 0) - (a.clip.layer ?? 0))
          .find(({ clip }) => video.currentTime >= clip.timelineStart && video.currentTime < clip.timelineStart + clip.duration);
        exportBrollVideos.forEach(({ video: auxiliaryVideo }) => {
          if (!activeExportBroll || auxiliaryVideo !== activeExportBroll.video) auxiliaryVideo.pause();
        });
        if (activeExportBroll) {
          const targetTime = activeExportBroll.clip.sourceStart + video.currentTime - activeExportBroll.clip.timelineStart;
          if (Math.abs(activeExportBroll.video.currentTime - targetTime) > .3) activeExportBroll.video.currentTime = targetTime;
          if (activeExportBroll.video.paused) activeExportBroll.video.play().catch(() => undefined);
          if (activeExportBroll.video.readyState >= 2) drawCinematicBroll(activeExportBroll.video, { x: activeExportBroll.clip.focusX, y: activeExportBroll.clip.focusY }, activeExportBroll.clip);
        }
        const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, "rgba(0,0,0,.16)");
        gradient.addColorStop(0.45, "rgba(0,0,0,0)");
        gradient.addColorStop(1, "rgba(0,0,0,.22)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (templateMode === "routine") {
          const scale = canvas.width / 1080;
          context.save();
          context.strokeStyle = "rgba(0,0,0,.85)";
          context.lineWidth = 10 * scale;
          context.beginPath();
          context.moveTo(canvas.width / 2, canvas.height * .185);
          context.lineTo(canvas.width / 2, canvas.height * .955);
          context.stroke();
          context.strokeStyle = "#ffffff";
          context.lineWidth = 5 * scale;
          context.stroke();
          context.restore();
          const headingStyle: TextStyle = { ...DEFAULT_TEXT_STYLES.labels, fontSize: 64, strokeWidth: 12, letterSpacing: -1 };
          styledCanvasText(context, routineHeadings.day, canvas.width * .25, canvas.height * .18, headingStyle, true);
          styledCanvasText(context, routineHeadings.night, canvas.width * .75, canvas.height * .18, headingStyle, true);
        }
        const exportSceneIndex = templateMode === "ranking" && rankingScenes.length > 1
          ? (() => { const found = rankingScenes.findIndex((scene, index) => video.currentTime >= rankingSceneStarts[index] && video.currentTime < rankingSceneStarts[index] + scene.duration); return found >= 0 ? found : rankingScenes.length - 1; })()
          : 0;
        const exportScene = rankingScenes[exportSceneIndex];
        const exportTitle = templateMode === "ranking" && rankingScenes.length > 1 ? exportScene?.title || settings.title : settings.title;
        const exportCategory = templateMode === "ranking" && rankingScenes.length > 1 ? exportScene?.category || settings.category : settings.category;
        const exportProductIndexes = templateMode === "ranking" && rankingScenes.length > 1
          ? products.map((_, index) => index).filter((index) => Math.floor(index / 3) === Math.min(exportSceneIndex, 3))
          : products.map((_, index) => index);
        const titleLayout = canvasLayouts.title;
        if (templateMode === "question-box") drawQuestionBox();
        else styledCanvasText(context, exportTitle, canvas.width * titleLayout.x / 100, canvas.height * titleLayout.y / 100, scaledTextStyle("title", "title"), true);
        if (templateMode === "timed-ranking") drawTimedRanking(video.currentTime);
        else if (templateMode !== "question-box") images.forEach((image, index) => {
            if (!exportProductIndexes.includes(index)) return;
            const labelId = `label-${index}` as CanvasElementId;
            const productId = `product-${index}` as CanvasElementId;
            const labelLayout = canvasLayouts[labelId];
            const productLayout = canvasLayouts[productId];
            styledCanvasText(context, products[index].label, canvas.width * labelLayout.x / 100, canvas.height * labelLayout.y / 100, scaledTextStyle("labels", labelId), true);
            if (image) {
              const productWidth = canvas.width * productLayout.width / 100;
              const productHeight = productWidth * 1.8;
              const scale = Math.min(productWidth / image.width, productHeight / image.height);
              const width = image.width * scale;
              const height = image.height * scale;
              context.save();
              context.translate(canvas.width * productLayout.x / 100, canvas.height * productLayout.y / 100);
              context.rotate((productLayout.rotation || 0) * Math.PI / 180);
              context.drawImage(image, -width / 2, -height / 2, width, height);
              context.restore();
            }
          });
        const categoryLayout = canvasLayouts.category;
        if (templateMode !== "question-box") styledCanvasText(context, exportCategory, canvas.width * categoryLayout.x / 100, canvas.height * categoryLayout.y / 100, scaledTextStyle("category", "category"), true);
        extraTextLayers.forEach((layer, index) => {
          const elementId = `extra-text-${layer.id}` as CanvasElementId;
          const layout = canvasLayouts[elementId] || { x: 50, y: 42 + index * 7, width: 72 };
          styledCanvasText(context, layer.text, canvas.width * layout.x / 100, canvas.height * layout.y / 100, scaledTextStyle("extra", elementId), true);
        });
        drawWatermark();
        const completedDuration = exportMainSegments.slice(0, exportMainIndex).reduce((total, segment) => total + segment.end - segment.start, 0);
        const activeExportSegment = exportMainSegments[exportMainIndex];
        const editedProgress = completedDuration + Math.max(0, video.currentTime - (activeExportSegment?.start || 0));
        setExportProgress(Math.min(100, Math.round(editedProgress / Math.max(.01, exportMainDuration) * 100)));
        raf = requestAnimationFrame(render);
      };
      video.onended = () => {
        const nextSegment = exportMainSegments[exportMainIndex + 1];
        if (nextSegment) {
          exportMainIndex += 1;
          video.currentTime = nextSegment.start;
          video.play().catch(reject);
        }
      };
      if (!superClip) {
        recorder.start(1000);
        startImportedAudio?.();
      }
      video.play().then(() => render()).catch(reject);
    });

    if (superClip) {
      video.currentTime = originalTime;
      video.muted = originalMuted;
      video.playbackRate = originalPlaybackRate;
      video.loop = false;
      return;
    }

    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    const exportBaseName = (activeFactoryProject?.name.trim() || videoFile.name.replace(/\.[^.]+$/, "") || "video").replace(/[\\/:*?"<>|]+/g, "-");
    anchor.download = `${exportBaseName}-${platform}-${exportPreset.width}x${exportPreset.height}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 3000);
    video.currentTime = originalTime;
    video.muted = originalMuted;
    video.playbackRate = originalPlaybackRate;
    video.loop = false;
    if (exportAudioContext) await exportAudioContext.close().catch(() => undefined);
    setExporting(false);
    setExportProgress(0);
    if (activeFactoryProject) patchFactoryProject(activeFactoryProject.id, { status: "downloaded" });
    setToast(`${exportPreset.name} exportado em ${exportPreset.width} × ${exportPreset.height}`);
  }

  // Waits until React committed the applied scene AND the <video> actually loaded
  // that scene's source (matching src + real dimensions), so the export never
  // reads the previous scene's still-loaded video.
  function settleAfterSceneApply(): Promise<void> {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video) { resolve(); return; }
      const expectedUrl = pendingSceneVideoUrlRef.current;
      const started = performance.now();
      const check = () => {
        const current = videoRef.current;
        if (!current) { resolve(); return; }
        const srcReady = !expectedUrl || current.src === expectedUrl || current.currentSrc === expectedUrl;
        if (srcReady && current.readyState >= 2 && current.videoWidth > 0) { window.setTimeout(resolve, 120); return; }
        if (performance.now() - started > 7000) { resolve(); return; }
        requestAnimationFrame(check);
      };
      // Let React commit the new src first, then poll until it is really loaded.
      requestAnimationFrame(() => requestAnimationFrame(check));
    });
  }

  async function exportSuperContent() {
    if (scenes.length < 2) { void exportVideo(); return; }
    if (!("MediaRecorder" in window)) { setToast("Este navegador não oferece exportação local"); return; }
    const activeIdBefore = activeSceneId;
    const currentData = captureSceneData();
    const orderedScenes = scenes.map((scene) => (scene.id === activeSceneId ? { ...scene, data: currentData } : scene));
    const missing = orderedScenes.find((scene) => !scene.data.videoFile);
    if (missing) { setToast(`Adicione um vídeo na cena "${missing.name}" antes de gerar o super conteúdo`); return; }
    setExporting(true);
    setShowExportDialog(false);
    setExportProgress(0);
    const preset = EXPORT_PRESETS[exportPresetId];
    const canvas = document.createElement("canvas");
    canvas.width = preset.width;
    canvas.height = preset.height;
    const context = canvas.getContext("2d")!;
    const compositionCanvas = document.createElement("canvas");
    compositionCanvas.width = preset.width;
    compositionCanvas.height = preset.height;
    const compositionContext = compositionCanvas.getContext("2d")!;
    const audioContext = new AudioContext();
    await audioContext.resume();
    const audioDestination = audioContext.createMediaStreamDestination();
    const canvasStream = canvas.captureStream(preset.fps);
    audioDestination.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    const mimeType = ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
    const recorderOptions: MediaRecorderOptions = { videoBitsPerSecond: preset.bitrate };
    if (mimeType) recorderOptions.mimeType = mimeType;
    const recorder = new MediaRecorder(canvasStream, recorderOptions);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const recorded = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
      recorder.onerror = () => reject(new Error("Falha na gravação"));
    });
    for (const track of importedAudios.filter((item) => item.volume > 0)) {
      try {
        if (!importedAudioBuffersRef.current[track.id]) importedAudioBuffersRef.current[track.id] = await audioContext.decodeAudioData(await track.file.arrayBuffer());
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = importedAudioBuffersRef.current[track.id];
        gain.gain.value = track.volume;
        source.connect(gain).connect(audioDestination);
        source.start(audioContext.currentTime + Math.max(0, track.offset));
      } catch { /* ignore a track that fails to decode */ }
    }
    recorder.start(1000);
    const baseClip = { canvas, context, compositionCanvas, compositionContext, recorder, audioContext, audioDestination, preset };
    let failed: string | null = null;
    for (let index = 0; index < orderedScenes.length; index += 1) {
      const scene = orderedScenes[index];
      // Pause recording while the next scene loads so the transition gap does not
      // add frozen frames to the final video.
      if (index > 0) { try { if (recorder.state === "recording") recorder.pause(); } catch { /* pause unsupported */ } }
      applySceneData(scene.data);
      await settleAfterSceneApply();
      try { if (recorder.state === "paused") recorder.resume(); } catch { /* resume unsupported */ }
      try {
        await exportSceneRef.current({ ...baseClip, sceneLabel: scene.name });
      } catch (error) {
        failed = error instanceof Error ? error.message : "Falha ao montar o super conteúdo";
        break;
      }
      setExportProgress(Math.round(((index + 1) / orderedScenes.length) * 100));
    }
    if (recorder.state !== "inactive") recorder.stop();
    let blob: Blob | null = null;
    try { blob = await recorded; } catch { failed = failed || "Falha na gravação"; }
    await audioContext.close().catch(() => undefined);
    applySceneData(currentData);
    setActiveSceneId(activeIdBefore);
    setExporting(false);
    setExportProgress(0);
    if (failed || !blob) { setToast(failed || "Não foi possível gerar o super conteúdo"); return; }
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `super-conteudo-${platform}-${preset.width}x${preset.height}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    setToast(`Super conteúdo com ${orderedScenes.length} cenas exportado`);
  }

  exportSceneRef.current = exportVideo;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div><strong>ClipPronto</strong><span>MVP local</span></div>
        </div>
        <div className="project-title">
          <span className="status-dot" /> {activeFactoryProject ? `${activeFactoryProject.name} · ${activeFactoryProject.status === "downloaded" ? "baixado" : activeFactoryProject.status === "edited" ? "editado" : "em ajuste"}` : "Edição salva neste dispositivo"}
        </div>
        <div className="top-actions">
          <label className="platform-select"><span>Destino</span><select value={platform} onChange={(event) => setPlatform(event.target.value as keyof typeof SAFE_ZONES)}><option value="instagram">Instagram Reels</option><option value="tiktok">TikTok</option></select></label>
          <button className="button ghost" onClick={saveTemplate}><Icon>▣</Icon> Salvar modelo</button>
          <button className="button primary" onClick={() => activePanel === "factory" ? editFirstSelectedFactoryProject() : setShowExportDialog(true)} disabled={activePanel === "factory" ? factoryPreparing || !factorySelectedIds.length : exporting || !videoFile}>
            {activePanel === "factory" ? (factoryPreparing ? "Preparando editor…" : "Editar selecionados") : (exporting ? `Exportando ${exportProgress}%` : "Baixar vídeo")}
          </button>
        </div>
      </header>

      <section
        className={`workspace ${videoFile && activePanel !== "factory" ? "with-timeline" : ""} ${activePanel === "factory" ? "factory-active" : ""}`}
        style={{ "--timeline-height": `${timelineVisibleHeight}px` } as React.CSSProperties}
      >
        <aside className="sidebar">
          <nav className="rail" aria-label="Ferramentas">
            <button className={activePanel === "edit" ? "active" : ""} onClick={() => setActivePanel("edit")}><Icon>✦</Icon><span>Editar</span></button>
            <button className={activePanel === "factory" ? "active" : ""} onClick={() => setActivePanel("factory")}><Icon>⚡</Icon><span>Fábrica</span></button>
            <button className={activePanel === "broll" ? "active" : ""} onClick={() => setActivePanel("broll")}><Icon>◫</Icon><span>Cinema</span></button>
            <button className={activePanel === "text" ? "active" : ""} onClick={() => setActivePanel("text")}><Icon>Aa</Icon><span>Texto</span></button>
            <button className={activePanel === "captions" ? "active" : ""} onClick={() => setActivePanel("captions")}><Icon>CC</Icon><span>Legendas</span></button>
            <button className={activePanel === "audio" ? "active" : ""} onClick={() => setActivePanel("audio")}><Icon>≋</Icon><span>Áudio</span></button>
          </nav>
          <div className="side-content">
            <div className="side-heading">
              <div><span className="eyebrow">Sua biblioteca</span><h2>Modelos</h2></div>
              <button className="square-button" onClick={saveTemplate} aria-label="Salvar modelo">＋</button>
            </div>
            <button className={`template-card ${templateMode === "ranking" ? "current" : ""}`} onClick={activateRankingTemplate}>
              <span className="template-thumb"><b>Bom</b><b>Melhor</b><b>Escolho</b></span>
              <span><strong>Ranking de 3 produtos</strong><small>Vertical · 9:16</small></span>
            </button>
            <button className={`template-card timed-ranking-template ${templateMode === "timed-ranking" ? "current" : ""}`} onClick={activateTimedRankingTemplate}>
              <span className="template-thumb timed-ranking"><i>1–</i><b /><i>2–</i><b /><i>3–</i><b /></span>
              <span><strong>Ranking animado</strong><small>1–10 itens · entradas por tempo</small></span>
            </button>
            <button className={`template-card routine-template ${templateMode === "routine" ? "current" : ""}`} onClick={activateRoutineTemplate}>
              <span className="template-thumb routine"><i>Dia ☀</i><i>Noite ☾</i><b /><b /></span>
              <span><strong>Rotina Dia & Noite</strong><small>Comparativo · 9 produtos</small></span>
            </button>
            <button className={`template-card react-template ${templateMode === "react" ? "current" : ""}`} onClick={activateReactTemplate}>
              <span className="template-thumb react"><i>CONTEÚDO</i><b>REACT</b></span>
              <span><strong>React sobre conteúdo</strong><small>Vídeo ou foto + apresentador</small></span>
            </button>
            <button className={`template-card question-box-template ${templateMode === "question-box" ? "current" : ""}`} onClick={activateQuestionBoxTemplate}>
              <span className="template-thumb question-box"><i>Qual é a sua dúvida?</i><b>Escreva a pergunta aqui</b></span>
              <span><strong>Caixinha de pergunta</strong><small>Texto editável · posição livre</small></span>
            </button>
            <button className={`template-card free-template ${templateMode === "free" ? "current" : ""}`} onClick={activateFreeTemplate}>
              <span className="template-thumb free"><i>Aa</i><i>□</i><i>＋</i></span>
              <span><strong>Modelo livre</strong><small>Arraste textos e imagens</small></span>
            </button>
            <button className={`template-card cinematic-template ${templateMode === "cinematic" ? "current" : ""}`} onClick={activateCinematicTemplate}>
              <span className="template-thumb cinematic"><i>FILM</i><b>◫</b><small>♪</small></span>
              <span><strong>Cinematográfico</strong><small>B-roll, cortes e efeitos</small></span>
            </button>
            {templates.map((template) => (
              <div className="saved-row" key={template.id}>
                <button className="template-card" onClick={() => loadTemplate(template)}>
                  <span className="template-thumb saved">{template.title.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{template.title}</strong><small>{new Date(template.savedAt).toLocaleDateString("pt-BR")}</small></span>
                </button>
                <button className="delete-template" onClick={() => deleteTemplate(template.id)} aria-label={`Excluir ${template.title}`}>×</button>
              </div>
            ))}
            {templates.length === 0 && <p className="empty-copy">Salve uma configuração para duplicá-la nos próximos vídeos.</p>}
          </div>
        </aside>

        <section className="canvas-area">
          {activePanel === "factory" ? (
            <div className="factory-center">
              <header className="factory-hero">
                <div><span className="eyebrow">Produção em escala</span><h1>Exército de conteúdo</h1><p>Combine aberturas, desenvolvimentos e chamadas para criar variações prontas para testar.</p></div>
                <div className="factory-total"><strong>{factoryVariants.length}</strong><span>vídeos possíveis</span><small>{factoryInputMode === "single" ? "2–5 Hooks · Corpo e CTA fixos" : "até 3 × 3 × 3"}</small></div>
              </header>
              <div className="copy-sequence" aria-label="Ordem obrigatória do roteiro">
                {FACTORY_SECTIONS.map((section, index) => <div key={section.id}><span style={{ background: section.color }}>{section.order}</span><strong>{section.name}</strong><small>{section.description}</small>{index < 2 && <b>→</b>}</div>)}
              </div>
              {!factoryGenerated ? (
                <section className="factory-empty-state">
                  <div className="factory-orbit"><span>H</span><span>C</span><span>CTA</span><b>{factoryInputMode === "single" ? "×2–5" : "×27"}</b></div>
                  <h2>{factoryInputMode === "single" ? "Envie um vídeo completo" : "Monte os três bancos de vídeo"}</h2>
                  <p>{factoryInputMode === "single" ? "A Fábrica procura, dentro do próprio Corpo, trechos fortes que funcionam como abertura. Cada trecho pode receber um formato diferente, enquanto o Corpo completo e o CTA permanecem iguais." : "Quando houver ao menos um vídeo em cada etapa, o sistema cria todas as combinações mantendo a ordem correta do copywriting."}</p>
                  <ul><li>pausas longas identificadas e removidas</li><li>volume de fala equilibrado entre os trechos</li><li>cada combinação permanece selecionável</li></ul>
                </section>
              ) : (
                <section className="factory-results">
                  <div className="factory-results-head">
                    <div><span className="eyebrow">Matriz pronta</span><h2>{factoryVariants.length} variações geradas</h2></div>
                    <div><button onClick={() => setFactorySelectedIds(factoryVariants.map((variant) => variant.id))}>Selecionar todas</button><button onClick={() => setFactorySelectedIds([])}>Limpar</button></div>
                  </div>
                  <div className="variant-grid">
                    {factoryVariants.map((variant) => {
                      const selected = factorySelectedIds.includes(variant.id);
                      const hookIndex = factoryClips.hook.findIndex((clip) => clip.id === variant.hook.id) + 1;
                      const bodyIndex = factoryClips.body.findIndex((clip) => clip.id === variant.body.id) + 1;
                      const ctaIndex = factoryClips.cta.findIndex((clip) => clip.id === variant.cta.id) + 1;
                      const project = factoryProjects.find((item) => item.variantId === variant.id);
                      const statusLabel = project?.status === "downloaded" ? "Baixado" : project?.status === "edited" ? "Editado" : "Em ajuste";
                      return <article key={variant.id} className={`variant-card ${selected ? "selected" : ""} ${project?.status || "adjusting"}`}>
                        <button className="variant-check" onClick={() => setFactorySelectedIds((current) => selected ? current.filter((id) => id !== variant.id) : [...current, variant.id])} aria-label={selected ? "Remover da seleção" : "Selecionar vídeo"}>{selected ? "✓" : ""}</button>
                        <div className="variant-code"><b>H{hookIndex}</b><i>→</i><b>C{bodyIndex}</b><i>→</i><b>CTA{ctaIndex}</b></div>
                        <strong>{project?.name || `Conteúdo ${hookIndex}-${bodyIndex}-${ctaIndex}`}</strong><small>{variant.hook.name}</small><small>{variant.body.name} + {variant.cta.name}</small>
                        <footer><span>{formatTime(variant.duration)}</span><span>Hook: {FACTORY_HOOK_FORMATS.find((format) => format.id === (variant.hook.hookFormat || "standard"))?.name}</span></footer>
                        <div className="variant-actions"><span className={`project-status ${project?.status || "adjusting"}`}>{statusLabel}</span><button onClick={() => project && openFactoryProjectInEditor(project.id)} disabled={!project || factoryPreparing}>Abrir no editor →</button></div>
                      </article>;
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : (<>
          <div className="canvas-toolbar">
            <span>Preview · {safeZone.name}</span>
            <div className="canvas-toolbar-actions">
              {showSafeZone && (unsafeTargets.length > 0 ? <span className="margin-warning">⚠ {unsafeTargets.length} fora da margem</span> : <span className="margin-safe">✓ Área segura</span>)}
              <button className={`safe-zone-toggle ${showSafeZone ? "active" : ""}`} onClick={() => setShowSafeZone((current) => !current)}>{showSafeZone ? "Ocultar safe zone" : "Ver safe zone"}</button>
            </div>
          </div>

          <div className="scenes-bar">
            <div className="scenes-bar-label"><b>Cenas</b><small>{scenes.length > 1 ? `${scenes.length} modelos em sequência` : "Vincule modelos p/ um super conteúdo"}</small></div>
            <div className="scenes-list">
              {scenes.length === 0 ? (
                <div className="scene-chip active"><span className="scene-index">1</span><span className="scene-name">{TEMPLATE_LABELS[templateMode]}</span></div>
              ) : scenes.map((scene, index) => (
                <div key={scene.id} className={`scene-chip ${scene.id === activeSceneId ? "active" : ""}`}>
                  <button className="scene-chip-main" onClick={() => switchToScene(scene.id)} title="Editar esta cena">
                    <span className="scene-index">{index + 1}</span>
                    <span className="scene-name">{TEMPLATE_LABELS[scene.id === activeSceneId ? templateMode : scene.data.mode]}</span>
                  </button>
                  <span className="scene-chip-actions">
                    <button onClick={() => moveScene(scene.id, -1)} disabled={index === 0} aria-label="Mover para trás">‹</button>
                    <button onClick={() => moveScene(scene.id, 1)} disabled={index === scenes.length - 1} aria-label="Mover para frente">›</button>
                    <button className="danger" onClick={() => removeScene(scene.id)} aria-label="Remover cena">✕</button>
                  </span>
                </div>
              ))}
              <div className="scene-add">
                <button className="scene-add-btn" onClick={() => setShowLinkMenu((value) => !value)}>＋ Vincular modelo</button>
                {showLinkMenu && (
                  <div className="scene-add-menu">
                    <div className="scene-add-title">Adicionar em sequência</div>
                    {(["ranking", "timed-ranking", "react", "question-box", "routine", "free", "cinematic"] as TemplateMode[]).map((mode) => (
                      <button key={mode} onClick={() => { setShowLinkMenu(false); linkNewScene(mode); }}>{TEMPLATE_LABELS[mode]}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="phone-frame">
            <div ref={stageRef} className="video-stage" onPointerDown={() => setSelectedElement(null)} onDrop={onVideoDrop} onDragOver={(event) => event.preventDefault()}>
              {templateMode === "react" && reactMediaUrl && (reactMediaType === "video"
                ? <video className="react-background-media" src={reactMediaUrl} muted autoPlay loop playsInline />
                : <img className="react-background-media" src={reactMediaUrl} alt="Conteúdo adicional do React" />)}
              {templateMode === "react" && !reactMediaUrl && <button className="react-background-placeholder" onClick={() => reactMediaInputRef.current?.click()}><span>＋</span><strong>Adicionar conteúdo de fundo</strong><small>Vídeo ou imagem que será comentado</small></button>}
              {videoUrl ? (
                <div className={`main-video-layer ${templateMode === "react" ? "react-main-layer" : ""} ${templateMode === "react" && reactRemoveBackground ? `background-removal-${reactSegmentationStatus}` : ""}`} style={mainPreviewStyle()} onPointerDown={beginReactOverlayDrag} onPointerMove={moveReactOverlayDrag} onPointerUp={endReactOverlayDrag} onPointerCancel={endReactOverlayDrag} onClick={() => {
                  const index = Math.max(0, orderedVideoSegments.findIndex((segment) => currentTime >= segment.start && currentTime < segment.end));
                  setTimelineSelection({ kind: "main", index });
                }}>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    style={{ objectPosition: `${mainCrop.x}% ${mainCrop.y}%`, transform: `scale(${mainCrop.zoom})`, transformOrigin: `${mainCrop.x}% ${mainCrop.y}%` }}
                    muted={settings.removeAudio}
                    playsInline
                    controls={templateMode !== "react"}
                    onLoadedMetadata={(event) => {
                      handleLoadedVideoMetadata(event.currentTarget);
                      event.currentTarget.playbackRate = playbackSpeed;
                      setCurrentTime(event.currentTarget.currentTime);
                    }}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onPlay={() => { setIsPlaying(true); startPlaybackMonitor(); }}
                    onPause={() => { setIsPlaying(false); stopPlaybackMonitor(); }}
                  />
                  {templateMode === "react" && reactRemoveBackground && <canvas ref={reactTransparentCanvasRef} className="react-transparent-video" style={{ objectPosition: `${mainCrop.x}% ${mainCrop.y}%`, transform: `scale(${mainCrop.zoom})`, transformOrigin: `${mainCrop.x}% ${mainCrop.y}%` }} aria-label="Vídeo principal com fundo transparente" />}
                  {templateMode === "react" && reactRemoveBackground && reactSegmentationStatus !== "ready" && <span className={`react-segmentation-badge ${reactSegmentationStatus}`}>{reactSegmentationStatus === "error" ? "Não foi possível remover o fundo" : "Removendo fundo…"}</span>}
                </div>
              ) : photoReelUrl ? (
                <div className="main-video-layer photo-reel-preview"><img src={photoReelUrl} alt="Foto principal para transformar em Reels" style={{ objectPosition: `${mainCrop.x}% ${mainCrop.y}%`, transform: `scale(${mainCrop.zoom})`, transformOrigin: `${mainCrop.x}% ${mainCrop.y}%` }} /><span>{photoReelDuration}s · prévia do Reels</span></div>
              ) : (
                templateMode === "react" ? <button className="react-speaker-placeholder" style={mainPreviewStyle()} onClick={() => fileInputRef.current?.click()}>
                  <span>▶</span><strong>Vídeo principal</strong><small>Quem fará o React</small>
                </button> : <button className="video-placeholder" onClick={() => fileInputRef.current?.click()}>
                  <span className="upload-orb">↑</span>
                  <strong>Adicione o vídeo principal</strong>
                  <small>Arraste aqui ou clique para escolher</small>
                </button>
              )}
              {activeBroll && <div key={activeBroll.id} className="broll-preview-layer" style={brollPreviewStyle()}><video ref={brollPreviewRef} className="broll-preview" style={{ objectPosition: `${activeBroll.focusX}% ${activeBroll.focusY}%` }} src={activeBroll.url} muted playsInline aria-label={`Vídeo complementar ${activeBroll.name}`} onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = activeBroll.sourceStart + Math.max(0, currentTime - activeBroll.timelineStart);
                if (isPlaying) event.currentTarget.play().catch(() => undefined);
              }} /></div>}
              {activeBroll && cinematicLayout === "split-bar" && <span className={`split-preview-bar ${splitDirection}`} style={splitDirection === "horizontal" ? { top: `${splitPosition}%`, height: `${Math.max(1, splitBarSize / 3)}px`, background: splitBarColor } : { left: `${splitPosition}%`, width: `${Math.max(1, splitBarSize / 3)}px`, background: splitBarColor }} aria-hidden="true" />}
              {focusEditMode && <div className="focus-adjust-overlay" onPointerDown={beginFocusDrag} onPointerMove={moveFocusDrag} onPointerUp={endFocusDrag} onPointerCancel={endFocusDrag}><span>Arraste o vídeo para ajustar o enquadramento</span></div>}
              <div className="stage-shade" />
              {templateMode === "routine" && <div className="routine-stage-overlay" aria-hidden="true"><span className="routine-divider" /><strong className="routine-day">{routineHeadings.day}</strong><strong className="routine-night">{routineHeadings.night}</strong></div>}
              {templateMode === "timed-ranking" && (
                <div
                  className={`timed-ranking-list ${rankingSettings.position}`}
                  style={{ "--rank-count": rankingSettings.count, "--rank-gap": `${rankingSettings.numberSpacing}cqw` } as React.CSSProperties}
                  aria-label={`Ranking com ${rankingSettings.count} itens`}
                >
                  {visibleProducts.map((product, index) => (
                    <div className="timed-rank-item" key={index} style={rankingItemStyle(index)} onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "ranking", index }); }}>
                      <strong className="timed-rank-number" style={rankingPartStyle(index, "number")}>{index + 1}<span>–</span></strong>
                      <span className={`timed-rank-media ${product.url ? "has-image" : ""}`} style={rankingPartStyle(index, "media")}>
                        {product.url ? <img src={product.url} alt={product.name} draggable={false} /> : <i>＋</i>}
                        {product.label && <small>{product.label}</small>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {platform === "tiktok" && (
                <div className="tiktok-commerce-guide" aria-hidden="true">
                  <div className="tiktok-search">⌕ <span>Encontrar conteúdo relacionado</span></div>
                  <div className="tiktok-actions"><span>♡</span><span>●●●</span><span>▮</span><span>➤</span></div>
                  <div className="tiktok-shop-bar"><b>🛒</b><span>Loja · Clique para COMPRAR</span></div>
                  <div className="tiktok-caption"><strong>@seuperfil</strong><span>Conheça esse produto</span></div>
                </div>
              )}
              {showSafeZone && (
                <div className={`safe-zone-guides ${unsafeTargets.length ? "has-warning" : ""}`} aria-hidden="true">
                  <span className="unsafe-band top" style={{ height: `${safeZone.top}%` }} />
                  <span className="unsafe-band right" style={{ width: `${safeZone.right}%`, top: `${safeZone.top}%`, bottom: `${safeZone.bottom}%` }} />
                  <span className="unsafe-band bottom" style={{ height: `${safeZone.bottom}%` }} />
                  <span className="unsafe-band left" style={{ width: `${safeZone.left}%`, top: `${safeZone.top}%`, bottom: `${safeZone.bottom}%` }} />
                  <span className="safe-zone-frame" style={{ top: `${safeZone.top}%`, right: `${safeZone.right}%`, bottom: `${safeZone.bottom}%`, left: `${safeZone.left}%` }}><i>{safeZone.name} · área segura</i></span>
                </div>
              )}
              {templateMode === "question-box" && <div className={`canvas-element question-box-element ${selectedElement === "question-box" ? "selected" : ""}`} style={{ left: `${canvasLayouts["question-box"].x}%`, top: `${canvasLayouts["question-box"].y}%`, width: `${canvasLayouts["question-box"].width}%`, "--question-border-width": `${questionBox.borderEnabled ? Math.max(.5, questionBox.borderWidth / 3) : 0}px`, "--question-border-color": questionBox.borderColor, "--question-border-radius": `${questionBox.borderRadius / 3}px` } as React.CSSProperties} onPointerDown={(event) => beginCanvasInteraction(event, "question-box", "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                <div className="question-box-prompt">{questionBox.prompt || "Digite a chamada da pergunta"}</div>
                <div className="question-box-answer">{questionBox.answer || "Digite a pergunta recebida"}</div>
                <span className="element-name">Caixinha de pergunta</span><button className="resize-handle" aria-label="Redimensionar caixinha de pergunta" onPointerDown={(event) => beginCanvasInteraction(event, "question-box", "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
              </div>}
              {templateMode !== "question-box" && (templateMode !== "cinematic" || settings.title) && <div className={`canvas-element text-element ${selectedElement === "title" ? "selected" : ""}`} style={{ left: `${canvasLayouts.title.x}%`, top: `${canvasLayouts.title.y}%`, width: `${canvasLayouts.title.width}%` }} onPointerDown={(event) => beginCanvasInteraction(event, "title", "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                <h1 ref={titleRef} key={templateMode === "ranking" ? activeRankingScene?.id : "title"} className={`stage-title scene-changing ${showSafeZone && unsafeTargets.includes("title") ? "unsafe-text" : ""}`} style={previewTextStyle(scaledTextStyle("title", "title"))}>{activeTitle || "Seu título"}</h1>
                <span className="element-name">Texto</span><button className="resize-handle" aria-label="Redimensionar título" onPointerDown={(event) => beginCanvasInteraction(event, "title", "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
              </div>}
              {templateMode !== "timed-ranking" && templateMode !== "question-box" && products.map((product, index) => {
                const labelId = `label-${index}` as CanvasElementId;
                const productId = `product-${index}` as CanvasElementId;
                if (templateMode === "ranking" && !rankingSceneProductIndexes.includes(index)) return null;
                return (
                  <div key={index}>
                    {(templateMode !== "cinematic" || product.label) && <div className={`canvas-element text-element ${selectedElement === labelId ? "selected" : ""}`} style={{ left: `${canvasLayouts[labelId].x}%`, top: `${canvasLayouts[labelId].y}%`, width: `${canvasLayouts[labelId].width}%` }} onPointerDown={(event) => beginCanvasInteraction(event, labelId, "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                      <span ref={(element) => { labelRefs.current[index] = element; }} className={`product-label ${showSafeZone && unsafeTargets.includes("labels") ? "unsafe-text" : ""}`} style={{ ...previewTextStyle(scaledTextStyle("labels", labelId)), textAlign: "center" }}>{product.label || (templateMode === "free" ? "Texto" : product.label)}</span>
                      <span className="element-name">Texto {index + 1}</span><button className="resize-handle" aria-label={`Redimensionar texto ${index + 1}`} onPointerDown={(event) => beginCanvasInteraction(event, labelId, "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
                    </div>}
                    {(templateMode !== "cinematic" || product.url) && <div className={`canvas-element image-element ${selectedElement === productId ? "selected" : ""}`} style={{ left: `${canvasLayouts[productId].x}%`, top: `${canvasLayouts[productId].y}%`, width: `${canvasLayouts[productId].width}%`, "--element-rotation": `${canvasLayouts[productId].rotation || 0}deg` } as React.CSSProperties} onPointerDown={(event) => beginCanvasInteraction(event, productId, "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                      {product.url ? <img src={product.url} alt={product.name} draggable={false} /> : <span className="product-ghost">{templateMode === "routine" ? "＋" : index + 1}</span>}
                      <span className="element-name">Produto {index + 1}</span><button className="rotate-handle" aria-label={`Girar produto ${index + 1}`} title="Girar produto" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); rotateProduct(productId, 15); }}>↻</button><button className="resize-handle" aria-label={`Redimensionar produto ${index + 1}`} onPointerDown={(event) => beginCanvasInteraction(event, productId, "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
                    </div>}
                  </div>
                );
              })}
              {templateMode !== "question-box" && ((templateMode !== "cinematic" && templateMode !== "timed-ranking") || settings.category) && <div className={`canvas-element text-element ${selectedElement === "category" ? "selected" : ""}`} style={{ left: `${canvasLayouts.category.x}%`, top: `${canvasLayouts.category.y}%`, width: `${canvasLayouts.category.width}%` }} onPointerDown={(event) => beginCanvasInteraction(event, "category", "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                <h2 ref={categoryRef} key={templateMode === "ranking" ? `${activeRankingScene?.id}-category` : "category"} className={`stage-category scene-changing ${showSafeZone && unsafeTargets.includes("category") ? "unsafe-text" : ""}`} style={previewTextStyle(scaledTextStyle("category", "category"))}>{activeCategory || (templateMode === "free" ? "Texto livre" : "Categoria")}</h2>
                <span className="element-name">Texto</span><button className="resize-handle" aria-label="Redimensionar categoria" onPointerDown={(event) => beginCanvasInteraction(event, "category", "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
              </div>}
              {extraTextLayers.map((layer, index) => {
                const elementId = `extra-text-${layer.id}` as CanvasElementId;
                const layout = canvasLayouts[elementId] || { x: 50, y: 42 + index * 7, width: 72 };
                return <div key={layer.id} className={`canvas-element text-element extra-text-element ${selectedElement === elementId ? "selected" : ""}`} style={{ left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%` }} onPointerDown={(event) => beginCanvasInteraction(event, elementId, "drag")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction}>
                  <span ref={(element) => { extraTextRefs.current[layer.id] = element; }} className={`extra-stage-text ${showSafeZone && unsafeTargets.includes("extra") ? "unsafe-text" : ""}`} style={previewTextStyle(scaledTextStyle("extra", elementId))}>{layer.text || "Texto livre"}</span>
                  <span className="element-name">Texto livre {index + 1}</span><button className="resize-handle" aria-label={`Redimensionar texto livre ${index + 1}`} onPointerDown={(event) => beginCanvasInteraction(event, elementId, "resize")} onPointerMove={moveCanvasInteraction} onPointerUp={endCanvasInteraction} onPointerCancel={endCanvasInteraction} />
                </div>;
              })}
              {watermarkEnabled && (
                <div
                  className={`canvas-element watermark-element ${watermarkFormat} ${watermarkTheme} ${selectedElement === "watermark" ? "selected" : ""}`}
                  style={{ left: `${watermarkLayout.x}%`, top: `${watermarkLayout.y}%`, fontSize: `${watermarkLayout.width * .15}cqw`, opacity: watermarkOpacity }}
                  onPointerDown={(event) => beginWatermarkInteraction(event, "drag")}
                  onPointerMove={moveWatermarkInteraction}
                  onPointerUp={endWatermarkInteraction}
                  onPointerCancel={endWatermarkInteraction}
                  onContextMenu={(event) => openContextMenu(event, { kind: "watermark" })}
                >
                  <div className="wm-photo">{watermarkPhotoUrl && <img src={watermarkPhotoUrl} alt="Foto da marca" draggable={false} />}</div>
                  <div className="wm-body">
                    {watermarkFormat === "full" ? <>
                      <span className="wm-name">{watermarkName || "Seu Nome"}</span>
                      <span className="wm-line">
                        <span className="wm-handle">{watermarkHandle || "@seuusuario"}</span>
                        {watermarkVerified && <VerifiedBadge className="wm-badge" />}
                      </span>
                    </> : <span className="wm-line">
                      <span className="wm-name">{watermarkName || "Seu Nome"}</span>
                      {watermarkVerified && <VerifiedBadge className="wm-badge" />}
                    </span>}
                  </div>
                  <span className="element-name">Marca</span>
                  <button className="resize-handle" aria-label="Redimensionar marca" onPointerDown={(event) => beginWatermarkInteraction(event, "resize")} onPointerMove={moveWatermarkInteraction} onPointerUp={endWatermarkInteraction} onPointerCancel={endWatermarkInteraction} />
                </div>
              )}
            </div>
          </div>
          <div className="preview-tip"><span>i</span> O vídeo é processado apenas neste computador.</div>
          </>)}
        </section>

        <aside className="inspector">
          {activePanel === "factory" ? (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Nova produção</span><h2>Fábrica de variações</h2></div><span className="format-pill">H → C → CTA</span></div>
              <div className="factory-input-mode" role="tablist" aria-label="Modo de entrada da Fábrica">
                <button className={factoryInputMode === "banks" ? "active" : ""} onClick={() => setFactoryInputMode("banks")} role="tab"><b>3 bancos</b><small>Vídeos separados</small></button>
                <button className={factoryInputMode === "single" ? "active" : ""} onClick={() => setFactoryInputMode("single")} role="tab"><b>Vídeo único</b><small>Varia apenas o Hook</small></button>
              </div>
              {factoryInputMode === "banks" ? <div className="factory-bank-list">
                {FACTORY_SECTIONS.map((section) => {
                  const clips = factoryClips[section.id];
                  return <section className={`factory-bank ${section.id}`} key={section.id} style={{ "--factory-color": section.color } as React.CSSProperties}>
                    <header><span>{section.order}</span><div><strong>{section.name}</strong><small>{section.description}</small></div><b>{clips.length}/3</b></header>
                    <div className="factory-clip-list">
                      {clips.map((clip, index) => <article key={clip.id} className={clip.status}>
                        <video src={clip.url} muted playsInline preload="metadata" />
                        <div><strong>{section.name} {index + 1}</strong><small title={clip.name}>{clip.name}</small><span>{clip.status === "analyzing" ? "Analisando pausas…" : clip.status === "error" ? "Falha na leitura" : `${formatTime(Math.max(0, clip.duration - clip.removedSeconds))} · ${clip.removedSeconds.toFixed(1)}s removidos`}</span></div>
                        <button onClick={() => removeFactoryClip(section.id, clip.id)} aria-label={`Remover ${clip.name}`}>×</button>
                      </article>)}
                    </div>
                    {clips.length < 3 && <label className="factory-add-clip"><input type="file" accept="video/*" multiple hidden onChange={(event) => { addFactoryFiles(section.id, event.target.files); event.currentTarget.value = ""; }} /><span>＋</span><div><strong>Adicionar {section.name}</strong><small>{3 - clips.length} espaço{3 - clips.length > 1 ? "s" : ""} disponível{3 - clips.length > 1 ? "is" : ""}</small></div></label>}
                  </section>;
                })}
              </div> : <section className={`single-factory-analyzer ${singleFactoryStatus}`}>
                <header><span>✦</span><div><strong>Gerar novos ganchos do próprio Corpo</strong><small>O sistema antecipa trechos fortes do Corpo; o Corpo completo e o CTA permanecem iguais.</small></div></header>
                <label className="single-factory-upload"><input type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) analyzeSingleFactoryVideo(file); event.currentTarget.value = ""; }} /><span>{singleFactoryStatus === "analyzing" ? "◌" : "＋"}</span><div><strong>{singleFactoryFile?.name || "Adicionar o vídeo completo"}</strong><small>{singleFactoryStatus === "analyzing" ? "Lendo falas e procurando ganchos em português…" : singleFactoryFile ? "Clique para substituir" : "Um único MP4, MOV ou WebM"}</small></div></label>
                {singleFactoryUrl && <div className="single-factory-preview"><video src={singleFactoryUrl} muted playsInline preload="metadata" /><div><strong>{singleFactoryStatus === "ready" ? `${factoryClips.hook.length} ganchos retirados do Corpo` : singleFactoryStatus === "error" ? "Não foi possível fragmentar" : "Analisando o contexto"}</strong><small>{singleFactoryStatus === "ready" ? "Corpo completo e CTA foram preservados" : "As pausas definem os limites naturais das frases"}</small></div></div>}
                <label className="single-hook-count"><span>Quantidade de ganchos <b>{singleFactoryHookCount}</b></span><input type="range" min="2" max="5" step="1" value={singleFactoryHookCount} disabled={singleFactoryStatus === "analyzing"} onChange={(event) => setSingleFactoryHookCount(Number(event.target.value))} /></label>
                {singleFactoryFile && <button className="single-factory-reanalyze" onClick={() => analyzeSingleFactoryVideo()} disabled={singleFactoryStatus === "analyzing"}>{singleFactoryStatus === "analyzing" ? "Analisando vídeo…" : `Criar ${singleFactoryHookCount} novos ganchos`}</button>}
                {singleFactoryStatus === "ready" && <div className="single-fragment-summary">{factoryClips.hook.map((clip, index) => <article key={clip.id} className={`single-hook-card ${clip.hookFormat || "standard"}`}>
                  <header><b>H{index + 1}</b><span>{formatTime(clip.sourceStart || 0)}–{formatTime(clip.sourceEnd || 0)}</span><em>do Corpo</em></header>
                  <p title={clip.sourceText}>{clip.sourceText || `Trecho do Corpo ${index + 1}`}</p>
                  <div className="hook-format-options" role="radiogroup" aria-label={`Formato do gancho ${index + 1}`}>{FACTORY_HOOK_FORMATS.map((format) => <button key={format.id} className={(clip.hookFormat || "standard") === format.id ? "active" : ""} onClick={() => { updateFactoryHook(clip.id, { hookFormat: format.id }); setToast(`Gancho ${index + 1} em formato ${format.name}`); }} title={format.note} aria-pressed={(clip.hookFormat || "standard") === format.id}><i>{format.icon}</i><span>{format.name}</span></button>)}</div>
                  {clip.hookFormat === "question" && <label className="hook-question-copy"><span>Texto da caixinha</span><textarea value={clip.sourceText || ""} maxLength={150} onChange={(event) => updateFactoryHook(clip.id, { sourceText: event.target.value })} /></label>}
                </article>)}</div>}
                {singleFactoryStatus === "ready" && factoryClips.hook.some((clip) => clip.hookFormat === "react" || clip.hookFormat === "split") && <label className="factory-support-video hook-support"><input type="file" accept="video/*" hidden onChange={(event) => chooseFactorySplitVideo(event.target.files?.[0])} /><span>◫</span><div><strong>{factorySplitFile?.name || "Vídeo de apoio dos ganchos"}</strong><small>{factorySplitFile ? "Usado somente nos Hooks React e Tela dividida" : "Opcional; adicione o conteúdo que aparecerá junto ao apresentador"}</small></div></label>}
                <p className="single-factory-privacy">Whisper local · sem cobrança por uso · o vídeo não é enviado para uma API de transcrição.</p>
              </section>}
              <button className="button factory-generate" onClick={generateFactoryVariants} disabled={!factoryVariants.length || Object.values(factoryClips).flat().some((clip) => clip.status === "analyzing") || singleFactoryStatus === "analyzing"}>
                {singleFactoryStatus === "analyzing" || Object.values(factoryClips).flat().some((clip) => clip.status === "analyzing") ? "Analisando os vídeos…" : factoryGenerated ? `Atualizar ${factoryVariants.length} variações` : `Criar ${factoryVariants.length || 0} variações`}
              </button>
              {factoryGenerated && <>
                <section className="control-section factory-finish">
                  <div className="section-title"><span className="field-label">Acabamento final</span><small>aplicado aos selecionados</small></div>
                  <div className="factory-style-grid">
                    {([
                      { id: "standard", icon: "▶", name: "Padrão", note: "Cortes limpos" },
                      { id: "cinematic", icon: "✦", name: "Cinema", note: "Cor, zoom e SFX" },
                      { id: "split", icon: "◫", name: "Dividida", note: "Principal + apoio" },
                    ] as Array<{ id: FactoryStyle; icon: string; name: string; note: string }>).map((style) => <button key={style.id} className={factoryStyle === style.id ? "active" : ""} onClick={() => setFactoryStyle(style.id)}><span>{style.icon}</span><strong>{style.name}</strong><small>{style.note}</small></button>)}
                  </div>
                  {factoryStyle === "split" && <label className="factory-support-video"><input type="file" accept="video/*" hidden onChange={(event) => chooseFactorySplitVideo(event.target.files?.[0])} /><span>◫</span><div><strong>{factorySplitFile?.name || "Vídeo complementar"}</strong><small>{factorySplitFile ? "Clique para substituir" : "Opcional; sem ele, o vídeo é reenquadrado nas duas telas"}</small></div></label>}
                </section>
                <section className="control-section factory-quality">
                  <div className="section-title"><span className="field-label">Qualidade real</span><small>{EXPORT_PRESETS[exportPresetId].width} × {EXPORT_PRESETS[exportPresetId].height}</small></div>
                  <div>{(Object.entries(EXPORT_PRESETS) as Array<[ExportPresetId, typeof EXPORT_PRESETS[ExportPresetId]]>).map(([id, preset]) => <button key={id} className={exportPresetId === id ? "active" : ""} onClick={() => setExportPresetId(id)}><strong>{preset.name}</strong><small>{preset.width}p</small></button>)}</div>
                </section>
                <section className="factory-export-summary">
                  <div><strong>{factorySelectedIds.length}</strong><span>selecionados de {factoryVariants.length}</span></div>
                  <button className="button primary" onClick={editFirstSelectedFactoryProject} disabled={!factorySelectedIds.length || factoryPreparing}>{factoryPreparing ? "Preparando editor…" : `Editar ${factorySelectedIds.length} vídeo${factorySelectedIds.length === 1 ? "" : "s"} um por vez`}</button>
                  <small>O primeiro selecionado será aberto no editor. Depois use “Próximo pendente” para continuar.</small>
                </section>
              </>}
              <p className="technical-note">{factoryInputMode === "single" ? "O Whisper analisa as falas localmente e procura trechos fortes dentro do Corpo. Não há envio do vídeo para API nem cobrança por minuto." : "A detecção de pausas dos bancos usa apenas o volume do áudio, sem envio para servidor ou cobrança por minuto."}</p>
            </>
          ) : activePanel === "edit" ? (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Conteúdo</span><h2>Personalizar modelo</h2></div><span className="format-pill">9:16</span></div>
              {activeFactoryProject && <section className="factory-project-editor">
                <header><span>⚡</span><div><strong>Vídeo aberto pela Fábrica</strong><small>Edite somente esta variação e baixe quando estiver pronta.</small></div></header>
                <label><span>Nome do vídeo</span><input value={activeFactoryProject.name} onChange={(event) => patchFactoryProject(activeFactoryProject.id, { name: event.target.value })} maxLength={80} /></label>
                <div className="project-status-control"><span>Status</span><div>
                  {(["adjusting", "edited", "downloaded"] as FactoryProjectStatus[]).map((status) => <button key={status} className={activeFactoryProject.status === status ? `active ${status}` : ""} onClick={() => patchFactoryProject(activeFactoryProject.id, { status })}>{status === "adjusting" ? "Em ajuste" : status === "edited" ? "Editado" : "Baixado"}</button>)}
                </div></div>
                <div className="factory-project-nav"><button onClick={() => setActivePanel("factory")}>← Voltar à Fábrica</button><button onClick={() => {
                  const next = factoryProjects.find((project) => project.id !== activeFactoryProject.id && project.status !== "downloaded");
                  if (next) openFactoryProjectInEditor(next.id); else setToast("Todos os outros vídeos já foram baixados");
                }}>Próximo pendente →</button></div>
              </section>}
              <section className="control-section">
                <label className="field-label">Vídeo principal</label>
                <input ref={fileInputRef} type="file" accept="video/*,image/*" hidden onChange={(event) => chooseMainMedia(event.target.files?.[0])} />
                <button className="media-picker" onClick={() => fileInputRef.current?.click()}>
                  <span className="media-icon">▶</span><span><strong>{videoFile?.name || photoReelFile?.name || "Selecionar vídeo ou foto"}</strong><small>{videoFile || photoReelFile ? "Clique para substituir" : "MP4, MOV, WebM, JPG ou PNG"}</small></span><b>Trocar</b>
                </button>
              </section>
              {photoReelFile && <section className="control-section photo-reel-builder">
                <div className="section-title"><span className="field-label">Foto como Reels</span><small>5–15 segundos</small></div>
                <div className="photo-reel-card"><img src={photoReelUrl} alt="Foto escolhida" /><div><strong>{photoReelFile.name}</strong><small>Movimento suave será aplicado para não parecer uma imagem parada.</small></div></div>
                <label><span>Duração do Reels <b>{photoReelDuration}s</b></span><input type="range" min="5" max="15" step="1" value={photoReelDuration} disabled={photoReelStatus === "rendering"} onChange={(event) => { const duration = Number(event.target.value); setPhotoReelDuration(duration); if (!videoFile) setVideoDuration(duration); }} /></label>
                <button className="create-photo-reel" onClick={convertPhotoToReel} disabled={photoReelStatus === "rendering"}>{photoReelStatus === "rendering" ? `Criando Reels… ${photoReelProgress}%` : videoFile ? `Recriar Reels com ${photoReelDuration}s` : `Transformar foto em Reels de ${photoReelDuration}s`}</button>
                {photoReelStatus === "rendering" && <progress max="100" value={photoReelProgress} />}
              </section>}
              {templateMode === "question-box" && <section className="control-section question-box-editor">
                <div className="section-title"><span className="field-label">Caixinha de pergunta</span><small>Fonte da referência</small></div>
                <p>Edite os dois textos. Depois clique na caixinha da prévia e arraste para qualquer posição.</p>
                <label><span>Chamada superior</span><textarea value={questionBox.prompt} maxLength={140} onChange={(event) => setQuestionBox((current) => ({ ...current, prompt: event.target.value }))} /></label>
                <label><span>Pergunta recebida</span><textarea value={questionBox.answer} maxLength={220} onChange={(event) => setQuestionBox((current) => ({ ...current, answer: event.target.value }))} /></label>
                <div className="question-border-controls">
                  <label className="question-border-toggle"><span><strong>Borda estilo Instagram</strong><small>Contorno acompanha todo o tamanho da caixinha</small></span><input type="checkbox" checked={questionBox.borderEnabled} onChange={(event) => setQuestionBox((current) => ({ ...current, borderEnabled: event.target.checked }))} /></label>
                  {questionBox.borderEnabled && <>
                    <label className="question-border-color"><span>Cor da borda</span><input type="color" value={questionBox.borderColor} onChange={(event) => setQuestionBox((current) => ({ ...current, borderColor: event.target.value }))} /></label>
                    <label><span>Espessura <b>{questionBox.borderWidth}px</b></span><input type="range" min="2" max="18" step="1" value={questionBox.borderWidth} onChange={(event) => setQuestionBox((current) => ({ ...current, borderWidth: Number(event.target.value) }))} /></label>
                    <label><span>Arredondamento <b>{questionBox.borderRadius}px</b></span><input type="range" min="0" max="44" step="1" value={questionBox.borderRadius} onChange={(event) => setQuestionBox((current) => ({ ...current, borderRadius: Number(event.target.value) }))} /></label>
                  </>}
                </div>
                <button onClick={() => { setCanvasLayouts((current) => ({ ...current, "question-box": { x: 50, y: 27, width: 91 } })); setSelectedElement("question-box"); }}>Centralizar e restaurar tamanho</button>
                <small className="question-box-tip">↔ Arraste para mover · o texto e a borda acompanham o tamanho automaticamente.</small>
              </section>}
              {templateMode === "react" && <section className="control-section react-builder">
                <div className="section-title"><span className="field-label">Conteúdo comentado</span><small>fundo do React</small></div>
                <input ref={reactMediaInputRef} type="file" accept="video/*,image/*" hidden onChange={(event) => chooseReactMedia(event.target.files?.[0])} />
                <button className="react-media-picker" onClick={() => reactMediaInputRef.current?.click()}><span>{reactMediaType === "image" && reactMediaFile ? "▧" : "▶"}</span><div><strong>{reactMediaFile?.name || "Adicionar vídeo ou imagem"}</strong><small>{reactMediaFile ? "Clique para substituir o conteúdo de fundo" : "Esta mídia ficará em tela cheia"}</small></div></button>
                <div className="react-role-note"><span>1</span><p><strong>Conteúdo adicional</strong> fica no fundo. <b>2</b> O vídeo principal fica sobreposto e pode ser arrastado.</p></div>
                <label className={`react-background-removal ${reactRemoveBackground ? "active" : ""} ${reactSegmentationStatus}`}>
                  <span className="react-background-removal-icon">✦</span>
                  <span><strong>Fundo transparente automático</strong><small>{!videoFile ? "Será aplicado assim que o apresentador for adicionado" : reactSegmentationStatus === "ready" ? "Pessoa recortada localmente e pronta para exportar" : reactSegmentationStatus === "error" ? "Falha no recorte. Desative e ative para tentar novamente" : reactRemoveBackground ? "Preparando o recorte do apresentador…" : "Mostrando o quadro original do vídeo"}</small></span>
                  <input type="checkbox" checked={reactRemoveBackground} onChange={(event) => setReactRemoveBackground(event.target.checked)} />
                </label>
                {reactRemoveBackground && <div className="react-mask-controls">
                  <label><span>Preservar pessoa <b>{Math.round((1 - reactMaskThreshold) * 100)}%</b></span><input type="range" min=".28" max=".75" step=".01" value={1 - reactMaskThreshold} onChange={(event) => setReactMaskThreshold(1 - Number(event.target.value))} /></label>
                  <label><span>Suavidade das bordas <b>{Math.round(reactEdgeSoftness * 100)}%</b></span><input type="range" min=".04" max=".3" step=".01" value={reactEdgeSoftness} onChange={(event) => setReactEdgeSoftness(Number(event.target.value))} /></label>
                  <small>Se cabelo ou mãos sumirem, aumente “Preservar pessoa”. Para reduzir contorno duro, aumente a suavidade.</small>
                </div>}
                <div className="react-position-presets">
                  <button onClick={() => setReactLayout((current) => ({ ...current, x: 4, y: 57 }))}>↙ Esquerda</button>
                  <button onClick={() => setReactLayout((current) => ({ ...current, x: 100 - current.width - 4, y: 57 }))}>Direita ↘</button>
                  <button onClick={() => setReactLayout((current) => ({ ...current, x: 4, y: 4 }))}>↖ Superior</button>
                  <button onClick={() => setReactLayout((current) => ({ ...current, x: (100 - current.width) / 2, y: 100 - current.height - 3 }))}>Centro ↓</button>
                </div>
                <div className="react-layout-sliders">
                  <label><span>Lado / posição horizontal <b>{Math.round(reactLayout.x)}%</b></span><input type="range" min="0" max={100 - reactLayout.width} step="1" value={reactLayout.x} onChange={(event) => setReactLayout((current) => ({ ...current, x: Number(event.target.value) }))} /></label>
                  <label><span>Posição vertical <b>{Math.round(reactLayout.y)}%</b></span><input type="range" min="0" max={100 - reactLayout.height} step="1" value={reactLayout.y} onChange={(event) => setReactLayout((current) => ({ ...current, y: Number(event.target.value) }))} /></label>
                  <label><span>Largura do apresentador <b>{Math.round(reactLayout.width)}%</b></span><input type="range" min="24" max="92" step="1" value={reactLayout.width} onChange={(event) => { const width = Number(event.target.value); setReactLayout((current) => ({ ...current, width, x: Math.min(current.x, 100 - width) })); }} /></label>
                  <label><span>Altura do apresentador <b>{Math.round(reactLayout.height)}%</b></span><input type="range" min="20" max="82" step="1" value={reactLayout.height} onChange={(event) => { const height = Number(event.target.value); setReactLayout((current) => ({ ...current, height, y: Math.min(current.y, 100 - height) })); }} /></label>
                  <label><span>Cantos arredondados <b>{Math.round(reactLayout.radius)}</b></span><input type="range" min="0" max="12" step="1" value={reactLayout.radius} onChange={(event) => setReactLayout((current) => ({ ...current, radius: Number(event.target.value) }))} /></label>
                </div>
                <p className="react-drag-tip">↔ Você também pode clicar no vídeo principal e arrastá-lo diretamente na prévia.</p>
              </section>}
              {videoFile && <section className="control-section merge-videos-control">
                <div className="section-title"><span className="field-label">Adicionar mais vídeos</span><small>{sequenceVideoClips.length} em sequência · {overlayVideoClips.length} sobrepostos</small></div>
                <p>Escolha se os novos vídeos entram conectados depois do principal ou em uma faixa de sobreposição acima dele.</p>
                <div className="additional-video-mode" role="radiogroup" aria-label="Posição dos vídeos adicionais">
                  <button className={additionalVideoMode === "sequence" ? "active" : ""} onClick={() => setAdditionalVideoMode("sequence")} role="radio" aria-checked={additionalVideoMode === "sequence"}><span>▥</span><div><strong>Sequência</strong><small>Um ao lado do outro</small></div></button>
                  <button className={additionalVideoMode === "overlay" ? "active" : ""} onClick={() => setAdditionalVideoMode("overlay")} role="radio" aria-checked={additionalVideoMode === "overlay"}><span>▣</span><div><strong>Sobreposição</strong><small>Faixa acima do principal</small></div></button>
                </div>
                <input ref={mergeInputRef} type="file" accept="video/*" multiple hidden onChange={(event) => addAdditionalVideos(event.target.files)} />
                <button className="merge-video-picker" onClick={() => mergeInputRef.current?.click()} disabled={brollStatus !== "idle"}><span>{brollStatus === "analyzing" ? "◌" : "＋"}</span><div><strong>{brollStatus === "analyzing" ? "Preparando vídeos…" : `Adicionar como ${additionalVideoMode === "sequence" ? "sequência" : "sobreposição"}`}</strong><small>Selecione até 8 arquivos · todos terão ajustes na timeline</small></div></button>
                {(sequenceVideoClips.length > 0 || overlayVideoClips.length > 0) && <div className="merge-summary"><span>✓ {sequenceVideoClips.length + overlayVideoClips.length} vídeos adicionais</span><button onClick={() => { setTimelineCollapsed(false); setTimelineHeight((current) => Math.max(430, current)); }}>Ver na timeline →</button></div>}
              </section>}
              {templateMode === "timed-ranking" && (
                <section className="control-section ranking-builder">
                  <div className="ranking-builder-heading">
                    <div><span className="field-label">Ranking animado</span><small>Entradas sincronizadas com o vídeo</small></div>
                    <output>{rankingSettings.count} itens</output>
                  </div>
                  <button className="harmonize-products" onClick={harmonizeRankingProducts} disabled={harmonizingProducts}>
                    <span>{harmonizingProducts ? "◌" : "▦"}</span>
                    <div><strong>{harmonizingProducts ? "Harmonizando imagens…" : "Alinhar tamanho dos produtos"}</strong><small>Recorta sobras transparentes, centraliza e aplica o mesmo quadro visual.</small></div>
                  </button>
                  <label className="ranking-count-control">
                    <span>Quantidade <b>1–10</b></span>
                    <input type="range" min="1" max="10" step="1" value={rankingSettings.count} onChange={(event) => {
                      const count = Number(event.target.value);
                      patchRankingSettings({ count });
                      setLinkProductIndex((current) => Math.min(current, count - 1));
                      setRankingScaleTarget((current) => Math.min(current, count - 1));
                    }} />
                  </label>
                  <div className="ranking-option-group">
                    <span>Como os itens aparecem</span>
                    <div className="ranking-segments two">
                      <button className={rankingSettings.revealMode === "sequential" ? "active" : ""} onClick={() => patchRankingSettings({ revealMode: "sequential" })}><b>Um por vez</b><small>Entram e permanecem</small></button>
                      <button className={rankingSettings.revealMode === "all" ? "active" : ""} onClick={() => patchRankingSettings({ revealMode: "all" })}><b>Todos juntos</b><small>Uma única entrada</small></button>
                    </div>
                  </div>
                  <div className="ranking-option-group">
                    <span>Ordem entre número e produto</span>
                    <div className="ranking-segments two">
                      <button className={rankingSettings.displayMode === "together" ? "active" : ""} onClick={() => patchRankingSettings({ displayMode: "together" })}><b>Número + produto</b><small>Aparecem juntos como agora</small></button>
                      <button className={rankingSettings.displayMode === "numbers-first" ? "active" : ""} onClick={() => patchRankingSettings({ displayMode: "numbers-first" })}><b>Número primeiro</b><small>Produto entra depois</small></button>
                    </div>
                  </div>
                  {rankingSettings.displayMode === "numbers-first" && <label className="ranking-duration-control compact">
                    <span>Atraso da imagem <b>{rankingSettings.numberLeadTime.toFixed(2).replace(".", ",")}s</b></span>
                    <input type="range" min=".15" max="2.5" step=".05" value={rankingSettings.numberLeadTime} onChange={(event) => patchRankingSettings({ numberLeadTime: Number(event.target.value) })} />
                  </label>}
                  <div className="ranking-option-group">
                    <span>Posição do ranking</span>
                    <div className="ranking-segments three">
                      {(["left", "right", "bottom"] as RankingPosition[]).map((position) => (
                        <button key={position} className={rankingSettings.position === position ? "active" : ""} onClick={() => patchRankingSettings({ position })}>
                          <b>{position === "left" ? "Lado esquerdo" : position === "right" ? "Lado direito" : "Abaixo"}</b>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ranking-option-group">
                    <span>Movimento de chegada</span>
                    <div className="ranking-motion-grid">
                      {RANKING_MOTIONS.map((motion) => (
                        <button key={motion.id} className={rankingSettings.motion === motion.id ? "active" : ""} title={motion.note} onClick={() => patchRankingSettings({ motion: motion.id })}>
                          <i>{motion.icon}</i><b>{motion.name}</b><small>{motion.note}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="ranking-duration-control">
                    <span>Duração do movimento <b>{rankingSettings.motionDuration.toFixed(2).replace(".", ",")}s</b></span>
                    <input type="range" min=".3" max="1.4" step=".05" value={rankingSettings.motionDuration} onChange={(event) => patchRankingSettings({ motionDuration: Number(event.target.value) })} />
                  </label>
                  <div className="ranking-fine-adjustments">
                    <label><span>Espaçamento entre números <b>{rankingSettings.numberSpacing.toFixed(1).replace(".", ",")}</b></span><input type="range" min="0" max="6" step=".25" value={rankingSettings.numberSpacing} onChange={(event) => patchRankingSettings({ numberSpacing: Number(event.target.value) })} /></label>
                    <div className="ranking-image-adjustment">
                      <div><span>Ajuste individual da imagem</span><select value={rankingScaleTarget} onChange={(event) => setRankingScaleTarget(Number(event.target.value))}>{visibleProducts.map((product, index) => <option value={index} key={index}>{index + 1}º · {product.name}</option>)}</select></div>
                      <label><span>Tamanho do produto <b>{Math.round((rankingSettings.itemScales[rankingScaleTarget] ?? 1) * 100)}%</b></span><input type="range" min=".55" max="1.55" step=".05" value={rankingSettings.itemScales[rankingScaleTarget] ?? 1} onChange={(event) => setRankingSettings((current) => ({ ...current, itemScales: current.itemScales.map((scale, index) => index === rankingScaleTarget ? Number(event.target.value) : scale) }))} /></label>
                      <button onClick={() => setRankingSettings((current) => ({ ...current, itemScales: current.itemScales.map((scale, index) => index === rankingScaleTarget ? 1 : scale) }))}>Restaurar 100%</button>
                    </div>
                  </div>
                  <div className="ranking-schedule-heading"><span>Momento de entrada</span><button onClick={distributeRankingTimes} disabled={!videoDuration}>Distribuir no vídeo</button></div>
                  <div className="ranking-schedule">
                    {(rankingSettings.revealMode === "all" ? visibleProducts.slice(0, 1) : visibleProducts).map((product, index) => (
                      <div key={index}>
                        <b>{rankingSettings.revealMode === "all" ? "Todos" : `${index + 1}º`}</b>
                        <span>{rankingSettings.revealMode === "all" ? `${rankingSettings.count} itens` : product.name}</span>
                        <input type="number" min="0" max={Math.max(videoDuration, rankingSettings.itemTimes[index])} step=".1" value={rankingSettings.itemTimes[index]} onChange={(event) => updateRankingTime(index, Number(event.target.value))} aria-label={`Entrada ${index + 1} em segundos`} />
                        <button onClick={() => seekVideo(rankingSettings.itemTimes[index])} disabled={!videoDuration}>▶</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {templateMode === "ranking" && <section className="control-section ranking-scenes-builder">
                <div className="ranking-scenes-heading"><div><span className="field-label">Títulos e categorias por tempo</span><small>{rankingScenes.length === 1 ? "1 quadro padrão" : `${rankingScenes.length} quadros no vídeo`}</small></div><button onClick={addRankingScene} disabled={rankingScenes.length >= 10}>＋ Novo quadro</button></div>
                <p>Cada quadro pode durar de 1 a 10 segundos. Com apenas um, o modelo continua no formato original.</p>
                <div className="ranking-scene-tabs">{rankingScenes.map((scene, index) => <button key={scene.id} className={selectedRankingScene === index ? "active" : ""} onClick={() => { setSelectedRankingScene(index); if (videoFile) seekVideo(Math.min(rankingSceneStarts[index] || 0, videoDuration)); }}><b>{index + 1}</b><span>{(rankingSceneStarts[index] || 0).toFixed(0)}s</span></button>)}</div>
                {rankingScenes[selectedRankingScene] && <div className="ranking-scene-editor">
                  <div className="ranking-scene-editor-head"><strong>Quadro {selectedRankingScene + 1}</strong><small>{(rankingSceneStarts[selectedRankingScene] || 0).toFixed(1).replace(".", ",")}s–{((rankingSceneStarts[selectedRankingScene] || 0) + rankingScenes[selectedRankingScene].duration).toFixed(1).replace(".", ",")}s</small>{rankingScenes.length > 1 && <button onClick={() => removeRankingScene(selectedRankingScene)}>Excluir</button>}</div>
                  <label><span>Título principal</span><input value={rankingScenes.length === 1 ? settings.title : rankingScenes[selectedRankingScene].title} maxLength={64} onChange={(event) => updateRankingScene(selectedRankingScene, { title: event.target.value })} /></label>
                  <label><span>Categoria</span><input value={rankingScenes.length === 1 ? settings.category : rankingScenes[selectedRankingScene].category} maxLength={30} onChange={(event) => updateRankingScene(selectedRankingScene, { category: event.target.value })} /></label>
                  <label className="ranking-scene-duration"><span>Duração <b>{rankingScenes[selectedRankingScene].duration}s</b></span><input type="range" min="1" max="10" step="1" value={rankingScenes[selectedRankingScene].duration} onChange={(event) => updateRankingScene(selectedRankingScene, { duration: Number(event.target.value) })} /></label>
                </div>}
              </section>}
              {templateMode !== "ranking" && templateMode !== "question-box" && <section className="control-section two-fields">
                <label><span className="field-label">Título principal</span><input value={settings.title} maxLength={64} onChange={(event) => patchSettings({ title: event.target.value })} /></label>
                <label><span className="field-label">Categoria</span><input value={settings.category} maxLength={30} onChange={(event) => patchSettings({ category: event.target.value })} /></label>
              </section>}
              {templateMode === "routine" && (
                <section className="control-section routine-heading-controls">
                  <div className="section-title"><span className="field-label">Nomes das colunas</span><small>Editáveis</small></div>
                  <div className="two-fields">
                    <label><span>Coluna esquerda</span><input value={routineHeadings.day} maxLength={18} onChange={(event) => setRoutineHeadings((current) => ({ ...current, day: event.target.value }))} /></label>
                    <label><span>Coluna direita</span><input value={routineHeadings.night} maxLength={18} onChange={(event) => setRoutineHeadings((current) => ({ ...current, night: event.target.value }))} /></label>
                  </div>
                  <small>Você pode trocar “Dia/Noite” por etapas, tipos de pele, marcas ou qualquer comparação.</small>
                </section>
              )}
              <section className="control-section extra-text-manager">
                <div className="section-title"><span className="field-label">Textos livres</span><small>Sem limite</small></div>
                <button className="add-extra-text" onClick={() => addExtraText()}><span>Aa＋</span><div><strong>Adicionar outro texto</strong><small>Complemento independente, arrastável e editável</small></div></button>
                {extraTextLayers.length > 0 && <div className="extra-text-list">{extraTextLayers.map((layer, index) => (
                  <div key={layer.id} className={selectedExtraTextId === layer.id ? "active" : ""}>
                    <button onClick={() => selectCanvasElement(`extra-text-${layer.id}` as CanvasElementId)}><b>Texto {index + 1}</b><span>{layer.text}</span></button>
                    <button onClick={() => removeExtraText(layer.id)} aria-label={`Remover texto ${index + 1}`}>×</button>
                  </div>
                ))}</div>}
              </section>
              {templateMode !== "question-box" && <section className="control-section">
                <div className="section-title"><span className="field-label">Produtos</span><small>{templateMode === "ranking" ? `${products.length}/10 · 3 por quadro` : "Fundo branco por padrão"}</small></div>
                {templateMode === "ranking" && <button className="add-ranking-product" onClick={addRankingProduct} disabled={products.length >= 10}><span>＋</span><div><strong>Adicionar mais um produto</strong><small>Será colocado automaticamente no próximo quadro disponível.</small></div></button>}
                <div className="product-controls">
                  {visibleProducts.map((product, index) => (
                    <div className="product-control" key={index}>
                      <label className="image-input">
                        <input type="file" accept="image/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => chooseProduct(index, event.target.files?.[0])} />
                        {processingProduct === index ? <span className="mini-spinner" /> : product.url ? <img src={product.url} alt="" /> : <span>＋</span>}
                      </label>
                      <div>
                        <input aria-label={`Nome do produto ${index + 1}`} value={product.name} onChange={(event) => updateProduct(index, { name: event.target.value })} />
                        <input aria-label={`Classificação do produto ${index + 1}`} className="label-input" value={product.label} onChange={(event) => updateProduct(index, { label: event.target.value })} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="product-link-importer">
                  <div className="link-importer-heading"><strong>Importar por link</strong><span>SEM APP EXTERNO</span></div>
                  <div className="background-mode-tabs" aria-label="Método para remover fundo">
                    <button type="button" className={backgroundRemovalMode === "white" ? "active" : ""} onClick={() => setBackgroundRemovalMode("white")}>
                      <strong>Fundo branco</strong><small>Ideal para produtos</small>
                    </button>
                    <button type="button" className={backgroundRemovalMode === "smart" ? "active" : ""} onClick={() => setBackgroundRemovalMode("smart")}>
                      <strong>Recorte inteligente</strong><small>Pessoas e cenários</small>
                    </button>
                  </div>
                  <div className="link-importer-row">
                    <select aria-label="Produto de destino" value={linkProductIndex} onChange={(event) => setLinkProductIndex(Number(event.target.value))}>
                      {visibleProducts.map((_, index) => <option value={index} key={index}>Produto {index + 1}</option>)}
                    </select>
                    <input
                      aria-label="Link público da imagem"
                      type="url"
                      placeholder="Cole o link da imagem ou Google Drive"
                      value={productLink}
                      onChange={(event) => setProductLink(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter" && !importingLink) importProductFromLink(); }}
                    />
                    <button disabled={importingLink || processingProduct !== null} onClick={importProductFromLink}>{importingLink ? "Importando…" : backgroundRemovalMode === "white" ? "Importar e remover branco" : "Importar e recortar"}</button>
                  </div>
                  <small>{backgroundRemovalMode === "white" ? "Preserva a cor, os textos e as áreas brancas da embalagem. Recomendado para fotos de produtos." : "Use apenas quando a imagem tiver pessoas ou um fundo complexo."} O arquivo do Drive precisa estar público.</small>
                </div>
                {processingProduct !== null && (
                  <div className="background-progress" role="status">
                    <div><span>{backgroundStage || "Analisando produto"}</span><b>{backgroundProgress}%</b></div>
                    <progress max="100" value={backgroundProgress} />
                    <small>{backgroundRemovalMode === "smart" ? "Na primeira vez, o navegador prepara o modelo; depois ele fica em cache." : "Modo conservador: remove somente o branco conectado às bordas e mantém textos, áreas claras e a resolução original."}</small>
                  </div>
                )}
              </section>}
              <section className="control-section compact-options">
                <label className="toggle-row"><span><strong>Remover áudio</strong><small>Exporta o vídeo totalmente mudo</small></span><input type="checkbox" checked={settings.removeAudio} onChange={(event) => patchSettings({ removeAudio: event.target.checked })} /></label>
              </section>
            </>
          ) : activePanel === "broll" ? (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Modelo cinematográfico</span><h2>Vídeos complementares</h2></div><span className="format-pill">B-roll</span></div>
              <div className="cinema-explainer"><span>◫</span><div><strong>Seleção automática de cenas</strong><p>O editor procura o trecho com melhor movimento e exposição e posiciona o corte no ritmo da fala.</p></div></div>
              <section className="control-section cinema-free-layers">
                <div className="section-title"><span className="field-label">Tela livre</span><small>Começa sem elementos</small></div>
                <input ref={cinematicImageInputRef} type="file" accept="image/*" hidden onChange={(event) => addCinematicImage(event.target.files?.[0])} />
                <div><button onClick={addCinematicText}><span>Aa</span><strong>Adicionar texto</strong></button><button onClick={() => cinematicImageInputRef.current?.click()}><span>▧</span><strong>Adicionar imagem</strong></button></div>
              </section>
              <section className="control-section broll-importer">
                <div className="video-target-tabs" role="radiogroup" aria-label="Destino do vídeo importado"><button className={videoLinkTarget === "main" ? "active" : ""} onClick={() => setVideoLinkTarget("main")} role="radio" aria-checked={videoLinkTarget === "main"}>Vídeo principal</button><button className={videoLinkTarget === "broll" ? "active" : ""} onClick={() => setVideoLinkTarget("broll")} role="radio" aria-checked={videoLinkTarget === "broll"}>Cena complementar</button></div>
                <input ref={brollInputRef} type="file" accept="video/*" hidden onChange={(event) => videoLinkTarget === "main" ? chooseVideo(event.target.files?.[0]) : addBrollFile(event.target.files?.[0])} />
                <button className="broll-upload" onClick={() => brollInputRef.current?.click()} disabled={brollStatus !== "idle"}><span>＋</span><div><strong>Adicionar vídeo autorizado</strong><small>MP4, MOV ou WebM · análise local</small></div></button>
                <div className="broll-link-row"><input type="url" value={brollLink} onChange={(event) => setBrollLink(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && brollStatus === "idle") importBrollFromLink(); }} placeholder="Link direto, Drive ou referência social" /><button onClick={importBrollFromLink} disabled={brollStatus !== "idle"}>Importar</button></div>
                <small>Links diretos e Google Drive público podem ser importados. YouTube, Shorts, Instagram, TikTok e Pinterest entram como referência e precisam do arquivo original autorizado.</small>
                {brollReference && <div className="protected-reference"><span>🔗</span><div><strong>Referência protegida salva</strong><small>{brollReference}</small></div><button onClick={() => brollInputRef.current?.click()}>Enviar original</button></div>}
                {brollStatus !== "idle" && <div className="broll-analyzing"><span className="mini-spinner" /><div><strong>{brollStatus === "importing" ? "Importando arquivo…" : "Escolhendo a melhor cena…"}</strong><small>Analisando movimento, luz e duração</small></div></div>}
              </section>
              <section className="control-section split-controls">
                <div className="section-title"><span className="field-label">Composição dos vídeos</span><small>Prévia e exportação</small></div>
                <div className="composition-modes">
                  <button className={cinematicLayout === "replace" ? "active" : ""} onClick={() => setCinematicLayout("replace")}><span>▣</span><strong>Corte normal</strong><small>O B-roll ocupa a tela</small></button>
                  <button className={cinematicLayout === "split-bar" ? "active" : ""} onClick={() => setCinematicLayout("split-bar")}><span>▤</span><strong>Tela dividida</strong><small>Separação com barra</small></button>
                  <button className={cinematicLayout === "split-gradient" ? "active" : ""} onClick={() => setCinematicLayout("split-gradient")}><span>◩</span><strong>Degradê</strong><small>Fusão suave</small></button>
                </div>
                {cinematicLayout !== "replace" && <div className="split-adjustments">
                  <div className="split-direction"><button className={splitDirection === "horizontal" ? "active" : ""} onClick={() => setSplitDirection("horizontal")}>Em cima / embaixo</button><button className={splitDirection === "vertical" ? "active" : ""} onClick={() => setSplitDirection("vertical")}>Lado a lado</button></div>
                  <div className="video-order"><span>Posição do complementar</span><div><button className={brollPlacement === "first" ? "active" : ""} onClick={() => setBrollPlacement("first")}>{splitDirection === "horizontal" ? "Em cima" : "À esquerda"}</button><button className={brollPlacement === "second" ? "active" : ""} onClick={() => setBrollPlacement("second")}>{splitDirection === "horizontal" ? "Embaixo" : "À direita"}</button></div></div>
                  <label><span><b>Divisão</b><output>{splitPosition}%</output></span><input type="range" min="25" max="75" value={splitPosition} onChange={(event) => setSplitPosition(Number(event.target.value))} /></label>
                  {cinematicLayout === "split-bar" && <div className="bar-adjustments"><label><span><b>Espessura</b><output>{splitBarSize}px</output></span><input type="range" min="2" max="24" value={splitBarSize} onChange={(event) => setSplitBarSize(Number(event.target.value))} /></label><label className="bar-color"><span>Cor da barra</span><input type="color" value={splitBarColor} onChange={(event) => setSplitBarColor(event.target.value)} /></label></div>}
                </div>}
                <div className="focus-controls">
                  <div className="section-title"><span className="field-label">Enquadramento inteligente</span><small>Local</small></div>
                  <div className="auto-focus-actions"><button onClick={autoFrameMainFace} disabled={focusStatus !== "idle" || !videoFile}><span>◎</span><strong>{focusStatus === "face" ? "Detectando…" : "Centralizar rosto"}</strong><small>Vídeo principal</small></button><button onClick={autoFrameComplementary} disabled={focusStatus !== "idle" || !brollClips.length}><span>✦</span><strong>{focusStatus === "scene" ? "Analisando…" : "Foco automático"}</strong><small>Vídeo complementar</small></button></div>
                  <button className={`manual-focus-toggle ${focusEditMode ? "active" : ""}`} onClick={() => setFocusEditMode((current) => !current)}><span>{focusEditMode ? "✓" : "↔"}</span><div><strong>{focusEditMode ? "Arraste na prévia agora" : "Ajustar arrastando"}</strong><small>Clique no vídeo e mova até enquadrar</small></div></button>
                  <button className="reset-focus" onClick={() => { pushEditorHistory(); setMainVideoFocus({ x: 50, y: 50 }); setMainCrop((current) => ({ ...current, x: 50, y: 50 })); setBrollClips((current) => current.map((clip) => ({ ...clip, focusX: 50, focusY: 50 }))); }}>Restaurar enquadramento central</button>
                </div>
              </section>
              <section className="control-section">
                <div className="section-title"><span className="field-label">Cortes cinematográficos</span><small>{brollClips.length} adicionados</small></div>
                <div className="broll-list">
                  {brollClips.length === 0 && <p className="empty-copy">Adicione um vídeo complementar. O melhor trecho aparecerá na timeline abaixo de “Removidos”.</p>}
                  {brollClips.map((clip) => (
                    <article className="broll-card" key={clip.id}>
                      <video src={clip.url} muted preload="metadata" />
                      <div className="broll-card-head"><strong>{clip.name}</strong><div><button onClick={() => seekVideo(clip.timelineStart)}>Ver</button><button onClick={() => removeBroll(clip.id)} aria-label={`Remover ${clip.name}`}>×</button></div></div>
                      <label><span>Entrada no principal <b>{formatTime(clip.timelineStart)}</b></span><input type="range" min="0" max={Math.max(0, videoDuration - clip.duration)} step=".1" value={clip.timelineStart} onChange={(event) => updateBroll(clip.id, { timelineStart: Number(event.target.value) })} /></label>
                      <label><span>Início da cena <b>{formatTime(clip.sourceStart)}</b></span><input type="range" min="0" max={Math.max(0, clip.sourceDuration - clip.duration)} step=".1" value={clip.sourceStart} onChange={(event) => updateBroll(clip.id, { sourceStart: Number(event.target.value) })} /></label>
                      <label className="broll-sfx"><span>Efeito do corte</span><div><select value={clip.sfx} onChange={(event) => updateBroll(clip.id, { sfx: event.target.value as SoundEffectId })}>{SOUND_EFFECTS.map((effect) => <option key={effect.id} value={effect.id}>{effect.name}</option>)}</select><button onClick={() => previewSoundEffect(clip.sfx)}>▶</button></div></label>
                    </article>
                  ))}
                </div>
              </section>
              <section className="control-section sound-bank">
                <div className="section-title"><span className="field-label">6 efeitos profissionais</span><small>Originais e livres</small></div>
                <div>{SOUND_EFFECTS.map((effect) => <button key={effect.id} onClick={() => previewSoundEffect(effect.id)}><span>▶</span><strong>{effect.name}</strong><small>{effect.note}</small></button>)}</div>
              </section>
              <p className="technical-note">A análise visual não interpreta o significado das imagens. Quando o nome do arquivo combina com palavras da transcrição, o editor usa essa fala para posicionar o corte.</p>
            </>
          ) : activePanel === "text" ? (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Tipografia local</span><h2>Personalizar texto</h2></div><span className="format-pill">12 fontes</span></div>
              <div className="text-target-tabs">
                <button className={textTarget === "title" ? "active" : ""} onClick={() => { setTextTarget("title"); setSelectedElement("title"); }}>Título</button>
                <button className={textTarget === "category" ? "active" : ""} onClick={() => { setTextTarget("category"); setSelectedElement("category"); }}>Categoria</button>
                <button className={textTarget === "labels" ? "active" : ""} onClick={() => { setTextTarget("labels"); setSelectedElement("label-0"); }}>Classificações</button>
                <button className={textTarget === "extra" ? "active" : ""} onClick={() => {
                  if (extraTextLayers.length) selectCanvasElement(`extra-text-${extraTextLayers[0].id}` as CanvasElementId);
                  else addExtraText();
                }}>Textos livres</button>
              </div>

              <section className="control-section text-content-control">
                <span className="field-label">Palavras</span>
                {textTarget === "title" && <textarea value={settings.title} maxLength={42} onChange={(event) => patchSettings({ title: event.target.value })} />}
                {textTarget === "category" && <textarea value={settings.category} maxLength={40} onChange={(event) => patchSettings({ category: event.target.value })} />}
                {textTarget === "labels" && <div className="label-text-list">{visibleProducts.map((product, index) => <input key={index} value={product.label} onChange={(event) => updateProduct(index, { label: event.target.value })} aria-label={`Classificação ${index + 1}`} />)}</div>}
                {textTarget === "extra" && selectedExtraText && <div className="extra-text-editor"><textarea value={selectedExtraText.text} maxLength={180} onChange={(event) => updateExtraText(selectedExtraText.id, event.target.value)} /><div><span>Texto independente {extraTextLayers.findIndex((layer) => layer.id === selectedExtraText.id) + 1}</span><button onClick={() => removeExtraText(selectedExtraText.id)}>Excluir texto</button></div></div>}
              </section>

              <section className="control-section font-section">
                <div className="section-title"><span className="field-label">Fontes instaladas</span><small>Uso comercial permitido</small></div>
                <div className="font-grid">
                  {FONT_OPTIONS.map((font) => (
                    <button
                      key={font.family}
                      className={activeTextStyle.fontFamily === font.family ? "active" : ""}
                      onClick={() => patchTextStyle({ fontFamily: font.family })}
                      title={font.note}
                    >
                      <span style={{ fontFamily: `"${font.family}"` }}>Aa</span><small>{font.name}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="control-section typography-controls">
                <label className="range-field"><span><b>Tamanho</b><output>{activeTextStyle.fontSize}px</output></span><input type="range" min="28" max="150" value={activeTextStyle.fontSize} onChange={(event) => patchTextStyle({ fontSize: Number(event.target.value) })} /></label>
                <label className="range-field"><span><b>Posição vertical</b><output>{Math.round(canvasLayouts[activeTextElementId].y)}%</output></span><input type="range" min="3" max="94" value={canvasLayouts[activeTextElementId].y} onChange={(event) => patchActiveTextPosition(Number(event.target.value))} /></label>
                <label className="range-field"><span><b>Contorno</b><output>{activeTextStyle.strokeWidth}px</output></span><input type="range" min="0" max="24" value={activeTextStyle.strokeWidth} onChange={(event) => patchTextStyle({ strokeWidth: Number(event.target.value) })} /></label>
                <label className="range-field"><span><b>Espaçamento</b><output>{activeTextStyle.letterSpacing}px</output></span><input type="range" min="-5" max="12" value={activeTextStyle.letterSpacing} onChange={(event) => patchTextStyle({ letterSpacing: Number(event.target.value) })} /></label>
                <div className="format-controls">
                  <button className={activeTextStyle.fontWeight >= 800 ? "active" : ""} onClick={() => patchTextStyle({ fontWeight: activeTextStyle.fontWeight >= 800 ? 400 : 900 })}><b>B</b></button>
                  <button className={activeTextStyle.italic ? "active" : ""} onClick={() => patchTextStyle({ italic: !activeTextStyle.italic })}><i>I</i></button>
                  <button className={activeTextStyle.underline ? "active" : ""} onClick={() => patchTextStyle({ underline: !activeTextStyle.underline })}><u>U</u></button>
                  <button className={activeTextStyle.uppercase ? "active" : ""} onClick={() => patchTextStyle({ uppercase: !activeTextStyle.uppercase })}>TT</button>
                  <span />
                  {(["left", "center", "right"] as const).map((align) => <button key={align} className={activeTextStyle.align === align ? "active" : ""} onClick={() => patchTextStyle({ align })}>{align === "left" ? "≡" : align === "center" ? "≣" : "≡"}</button>)}
                </div>
                <div className="color-controls">
                  <label><span>Letra</span><input type="color" value={activeTextStyle.color} onChange={(event) => patchTextStyle({ color: event.target.value })} /></label>
                  <label><span>Contorno</span><input type="color" value={activeTextStyle.strokeColor} onChange={(event) => patchTextStyle({ strokeColor: event.target.value })} /></label>
                  <label className="shadow-control"><span>Sombra</span><input type="checkbox" checked={activeTextStyle.shadow} onChange={(event) => patchTextStyle({ shadow: event.target.checked })} /></label>
                </div>
              </section>

              <section className="control-section preset-section">
                <div className="section-title"><span className="field-label">Estilos rápidos</span><small>Clique para aplicar</small></div>
                <div className="text-presets">
                  {TEXT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      title={preset.name}
                      style={{ color: preset.color, WebkitTextStroke: `${Math.min(2, preset.strokeWidth / 7)}px ${preset.strokeColor}`, background: preset.background === "transparent" ? "#34363d" : preset.background, textShadow: preset.shadow ? `0 0 7px ${preset.strokeColor}` : "none" }}
                      onClick={() => patchTextStyle(preset)}
                    >Aa</button>
                  ))}
                </div>
              </section>
              {showSafeZone ? <div className={`safe-zone-message ${unsafeTargets.includes(textTarget) ? "warning" : "safe"}`}><span>{unsafeTargets.includes(textTarget) ? "⚠" : "✓"}</span><div><strong>{unsafeTargets.includes(textTarget) ? "Texto fora da área segura" : `Seguro para ${safeZone.name}`}</strong><small>{unsafeTargets.includes(textTarget) ? "Arraste o texto ou reduza o tamanho pelas alças." : "Este texto não será coberto pelos controles da plataforma."}</small></div></div> : <button className="safe-zone-panel-button" onClick={() => setShowSafeZone(true)}>Verificar safe zone deste texto</button>}
              <p className="font-license-note">As fontes são armazenadas no próprio editor e distribuídas sob a licença SIL Open Font License. Fontes exclusivas da Meta foram representadas por equivalentes abertas.</p>
            </>
          ) : activePanel === "audio" ? (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Automação local</span><h2>Cortar pausas</h2></div><span className="format-pill">Sem IA</span></div>
              <div className="audio-explainer"><span className="wave">▂▅▇▃ ▁ ▂▆▇▅ ▁ ▃▆</span><strong>Detecção por volume</strong><p>O sistema procura trechos abaixo do volume definido. Nenhum conteúdo é enviado para a internet.</p></div>
              {factoryRemovedRanges.length > 0 && <section className="factory-audio-audit">
                <header><span>✓</span><div><strong>Ajustes trazidos da Fábrica</strong><small>{factoryRemovedRanges.length} pausas já removidas · {factoryRemovedRanges.reduce((total, range) => total + range.duration, 0).toFixed(1)}s</small></div></header>
                <div>{factoryRemovedRanges.slice(0, 8).map((range, index) => <button key={index} onClick={() => seekVideo(range.at)}><b>{range.section === "hook" ? "Hook" : range.section === "body" ? "Corpo" : "CTA"}</b><span>{formatTime(range.at)}</span><small>−{range.duration.toFixed(1)}s</small></button>)}</div>
                <p>Esses trechos já saíram do vídeo final. As marcas servem para revisão e não serão cortadas novamente.</p>
              </section>}
              <section className="control-section range-controls">
                <label><span><b>Sensibilidade</b><output>{settings.thresholdDb} dB</output></span><input type="range" min="-55" max="-22" value={settings.thresholdDb} onChange={(event) => patchSettings({ thresholdDb: Number(event.target.value) })} /></label>
                <label><span><b>Pausa mínima</b><output>{settings.minimumSilence.toFixed(1)} s</output></span><input type="range" min="0.3" max="2" step="0.1" value={settings.minimumSilence} onChange={(event) => patchSettings({ minimumSilence: Number(event.target.value) })} /></label>
                <label><span><b>Margem preservada</b><output>{settings.padding.toFixed(2)} s</output></span><input type="range" min="0.05" max="0.35" step="0.01" value={settings.padding} onChange={(event) => patchSettings({ padding: Number(event.target.value) })} /></label>
              </section>
              <button className="button analyze" onClick={analyzeSilence} disabled={!videoFile || analysisStatus === "working"}>{analysisStatus === "working" ? "Analisando áudio…" : "Analisar pausas do vídeo"}</button>
              {analysisStatus === "done" && (
                <section className="analysis-result">
                  <div><strong>{silentRanges.length}</strong><span>pausas detectadas</span></div>
                  <div><strong>{removedSeconds.toFixed(1)}s</strong><span>podem ser removidos</span></div>
                  <label className="toggle-row"><span><strong>Edição automática aplicada</strong><small>O preview e a exportação já pulam esses trechos</small></span><input type="checkbox" checked={settings.removeSilence} onChange={(event) => patchSettings({ removeSilence: event.target.checked })} /></label>
                  <div className="range-list">{silentRanges.slice(0, 5).map((range, index) => <span key={index}>{formatTime(range.start)} – {formatTime(range.end)}</span>)}</div>
                </section>
              )}
              {analysisStatus === "error" && <p className="error-message">{analysisError}</p>}
              <p className="technical-note">Dica: ambientes silenciosos geram cortes mais precisos. Revise o vídeo exportado antes de publicar.</p>
            </>
          ) : (
            <>
              <div className="inspector-heading"><div><span className="eyebrow">Whisper local</span><h2>Transcrever vídeo</h2></div><span className="format-pill">R$ 0 por uso</span></div>
              <div className="transcription-intro">
                <span>CC</span>
                <div><strong>Português automático</strong><p>O áudio é processado neste computador. Nenhuma fala é enviada para uma API de transcrição.</p></div>
              </div>
              <section className="control-section transcription-model">
                <div className="section-title"><span className="field-label">Precisão em português</span><small>{whisperQuality === "accurate" ? "Whisper Small" : "Whisper Base"}</small></div>
                <div className="whisper-quality-options" role="radiogroup" aria-label="Qualidade da transcrição">
                  <button
                    className={whisperQuality === "accurate" ? "active" : ""}
                    role="radio"
                    aria-checked={whisperQuality === "accurate"}
                    onClick={() => setWhisperQuality("accurate")}
                    disabled={transcriptionStatus === "loading" || transcriptionStatus === "transcribing"}
                  >
                    <span>Alta precisão</span><strong>Whisper Small</strong><small>Melhor reconhecimento de português, nomes e frases. Usa mais memória.</small>
                  </button>
                  <button
                    className={whisperQuality === "balanced" ? "active" : ""}
                    role="radio"
                    aria-checked={whisperQuality === "balanced"}
                    onClick={() => setWhisperQuality("balanced")}
                    disabled={transcriptionStatus === "loading" || transcriptionStatus === "transcribing"}
                  >
                    <span>Equilibrado</span><strong>Whisper Base</strong><small>Mais leve e rápido, com boa precisão para fala clara.</small>
                  </button>
                </div>
                <div className="model-detail"><span>PT</span><div><strong>Português definido no reconhecimento</strong><small>O modelo é baixado no primeiro uso e permanece no cache do navegador.</small></div></div>
              </section>
              <button className="button transcribe-button" onClick={transcribeVideoLocally} disabled={!videoFile || transcriptionStatus === "loading" || transcriptionStatus === "transcribing"}>
                {transcriptionStatus === "loading" ? "Preparando Whisper…" : transcriptionStatus === "transcribing" ? "Transcrevendo áudio…" : transcriptText ? "Transcrever novamente" : "Transcrever vídeo agora"}
              </button>
              {(transcriptionStatus === "loading" || transcriptionStatus === "transcribing") && (
                <div className="transcription-progress" role="status"><div><span>{transcriptionStatus === "loading" ? "Baixando/preparando modelo" : "Reconhecendo as palavras"}</span><b>{transcriptionProgress}%</b></div><progress max="100" value={transcriptionProgress} /><small>Mantenha esta aba aberta. O primeiro uso é o mais demorado.</small></div>
              )}
              {transcriptionStatus === "error" && <p className="error-message">{transcriptionError}</p>}
              {transcriptText && (
                <section className="transcript-result">
                  <div className="section-title"><span className="field-label">Transcrição</span><small>{transcriptChunks.length} trechos com tempo</small></div>
                  <textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} aria-label="Texto transcrito" />
                  <div className="transcript-actions"><button onClick={copyTranscript}>Copiar texto</button><button onClick={downloadTranscriptSrt} disabled={!transcriptChunks.length}>Baixar .SRT</button></div>
                  <div className="transcript-chunks">{transcriptChunks.slice(0, 8).map((chunk, index) => <button key={`${chunk.timestamp[0]}-${index}`} onClick={() => seekVideo(chunk.timestamp[0])}><time>{formatTime(chunk.timestamp[0])}</time><span>{chunk.text}</span></button>)}</div>
                </section>
              )}
              <p className="technical-note">Sem mensalidade e sem cobrança por minuto. O desempenho depende da duração do vídeo e da velocidade deste computador.</p>
            </>
          )}
        </aside>
      </section>
      {videoFile && activePanel !== "factory" && (
        <section
          className={`timeline-panel ${timelineCollapsed ? "collapsed" : ""}`}
          style={{ "--timeline-height": `${timelineVisibleHeight}px` } as React.CSSProperties}
          aria-label="Timeline de revisão e edição manual"
        >
          <div className="timeline-resize-handle" onPointerDown={beginTimelineResize} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} title="Arraste para aumentar ou diminuir a timeline"><i /><span>Arraste para redimensionar</span></div>
          <div className="timeline-toolbar">
            <div className="timeline-tools">
              <button className={`tool-button timeline-visibility-toggle ${timelineCollapsed ? "open" : ""}`} onClick={() => setTimelineCollapsed((current) => !current)}>{timelineCollapsed ? "⌃ Abrir timeline de edição" : "⌄ Recolher timeline"}</button>
              <button className="tool-button play" onClick={togglePlayback} aria-label={isPlaying ? "Pausar" : "Reproduzir"}>{isPlaying ? "Ⅱ" : "▶"}</button>
              <button className="tool-button" onClick={() => jumpToCut(-1)} disabled={!silentRanges.length} title="Corte anterior">◀│</button>
              <button className="tool-button" onClick={() => jumpToCut(1)} disabled={!silentRanges.length} title="Próximo corte">│▶</button>
              <span className="tool-separator" />
              <button className={`tool-button editor-action ${cropControlsOpen ? "active" : ""}`} onClick={() => { setCropControlsOpen((current) => !current); setTimelineCollapsed(false); setTimelineHeight((current) => Math.max(430, current)); }} title="Recortar e reenquadrar o vídeo">Crop</button>
              <button className="tool-button editor-action" onClick={splitMainVideo} title="Dividir o vídeo na posição do cursor">✂ Split</button>
              <button className="tool-button editor-action" onClick={() => deleteMainSide("left")} title="Excluir do início do trecho até o cursor">Excluir ←</button>
              <button className="tool-button editor-action" onClick={() => deleteMainSide("right")} title="Excluir do cursor até o fim do trecho">Excluir →</button>
              <button className="tool-button editor-action danger" onClick={() => timelineSelection?.kind === "main" ? removeMainSegment(timelineSelection.index) : setToast("Selecione um trecho do vídeo para excluir")} title="Excluir o trecho selecionado">Excluir</button>
              <button className={`tool-button editor-action ${audioExtracted ? "active" : ""}`} onClick={extractMainAudio} disabled={audioExtracted} title="Separar o áudio do vídeo">♪ Extrair áudio</button>
              <button className={`tool-button editor-action ${importedAudios.length ? "active" : ""}`} onClick={() => importedAudioInputRef.current?.click()} title="Importar música ou locução para tocar por cima do vídeo (pode adicionar vários)">♫ Importar áudio{importedAudios.length ? ` (${importedAudios.length})` : ""}</button>
              <input ref={importedAudioInputRef} type="file" accept="audio/*" multiple hidden onChange={(event) => { Array.from(event.target.files || []).forEach((file) => chooseImportedAudio(file)); event.currentTarget.value = ""; }} />
              {importedAudios.map((track) => <audio key={track.id} ref={(element) => { importedAudioElsRef.current[track.id] = element; }} src={track.url} preload="auto" />)}
              <button className={`tool-button editor-action ${watermarkEnabled ? "active" : ""}`} onClick={toggleWatermark} title="Selo com seu nome, @ e verificado para marcar o vídeo">✔ Minha marca</button>
              <label className="timeline-speed-control" title="Velocidade do vídeo e do áudio"><span>Speed</span><select value={playbackSpeed} onChange={(event) => changePlaybackSpeed(Number(event.target.value))}>{[.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
              <button className="tool-button editor-action" onClick={addTimelineMarker} title="Adicionar marcador na posição do cursor">◆ Marcador</button>
              <span className="tool-separator" />
              <button className="tool-button wide" onClick={addManualCut} title="Marca 0,8 segundo ao redor do cursor para remoção">✂ Marcar remoção</button>
              <button className="tool-button wide" onClick={undoEditorChange} disabled={!editorHistory.length}>↶ Undo</button>
              <button className="tool-button wide danger" onClick={resetEditorChanges}>Reset</button>
              <button className="tool-button wide danger" onClick={restoreAllCuts} disabled={!silentRanges.length}>Restaurar todos</button>
            </div>
            <div className="timeline-status">
              <span className="automatic-legend"><i /> Corte automático</span>
              <strong>{formatTime(currentTime)}</strong><span>/ {formatTime(videoDuration)}</span>
              <div className="timeline-zoom-control" title="Use Command/Ctrl + rolagem ou o controle para aproximar a timeline">
                <button onClick={() => zoomTimeline(-.5)} aria-label="Diminuir zoom da timeline">−</button>
                <input type="range" min="1" max="12" step=".25" value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} aria-label="Zoom da timeline" />
                <button onClick={() => zoomTimeline(.5)} aria-label="Aumentar zoom da timeline">＋</button>
                <output>{timelineZoom.toFixed(1)}×</output>
              </div>
              <div className="timeline-size-actions">
                <button onClick={() => { setTimelineHeight(250); setTimelineCollapsed(false); }}>Pequena</button>
                <button onClick={() => { setTimelineHeight(390); setTimelineCollapsed(false); }}>Média</button>
                <button onClick={() => { setTimelineHeight(Math.min(620, window.innerHeight - 250)); setTimelineCollapsed(false); }}>Grande</button>
              </div>
            </div>
          </div>

          {cropControlsOpen && <div className="timeline-crop-panel">
            <div><span className="crop-panel-icon">⌗</span><p><strong>Crop e enquadramento</strong><small>O ajuste será aplicado no preview e no vídeo exportado.</small></p></div>
            <label><span>Zoom <b>{mainCrop.zoom.toFixed(2)}×</b></span><input type="range" min="1" max="3" step=".05" value={mainCrop.zoom} onPointerDown={pushEditorHistory} onChange={(event) => setMainCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} /></label>
            <label><span>Horizontal <b>{Math.round(mainCrop.x)}%</b></span><input type="range" min="0" max="100" step="1" value={mainCrop.x} onPointerDown={pushEditorHistory} onChange={(event) => { const x = Number(event.target.value); setMainCrop((current) => ({ ...current, x })); setMainVideoFocus((current) => ({ ...current, x })); }} /></label>
            <label><span>Vertical <b>{Math.round(mainCrop.y)}%</b></span><input type="range" min="0" max="100" step="1" value={mainCrop.y} onPointerDown={pushEditorHistory} onChange={(event) => { const y = Number(event.target.value); setMainCrop((current) => ({ ...current, y })); setMainVideoFocus((current) => ({ ...current, y })); }} /></label>
            <button onClick={() => { pushEditorHistory(); setMainCrop({ zoom: 1, x: 50, y: 50 }); setMainVideoFocus({ x: 50, y: 50 }); }}>Centralizar</button>
            <button className="crop-close" onClick={() => setCropControlsOpen(false)}>Concluir</button>
          </div>}

          {watermarkEnabled && <div className="timeline-watermark-panel">
            <div className="wm-panel-head"><span className="wm-panel-icon"><VerifiedBadge /></span><p><strong>Minha marca</strong><small>Arraste no vídeo para posicionar e use a alça para o tamanho. Aparece no vídeo exportado.</small></p></div>
            <div className="wm-panel-photo">
              <button type="button" className="wm-photo-btn" onClick={() => watermarkPhotoInputRef.current?.click()} title="Adicionar foto">
                {watermarkPhotoUrl ? <img src={watermarkPhotoUrl} alt="Foto da marca" /> : <span>＋</span>}
              </button>
              <input ref={watermarkPhotoInputRef} type="file" accept="image/*" hidden onChange={(event) => { chooseWatermarkPhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <div className="wm-photo-actions">
                <button type="button" onClick={() => watermarkPhotoInputRef.current?.click()}>{watermarkPhotoUrl ? "Trocar foto" : "Adicionar foto"}</button>
                {watermarkPhotoUrl && <button type="button" className="danger" onClick={removeWatermarkPhoto}>Sem foto</button>}
              </div>
            </div>
            <label className="wm-field"><span>Nome</span><input type="text" value={watermarkName} onChange={(event) => setWatermarkName(event.target.value)} placeholder="Seu Nome" /></label>
            <label className="wm-field"><span>@ usuário</span><input type="text" value={watermarkHandle} onChange={(event) => setWatermarkHandle(event.target.value)} placeholder="@seuusuario" /></label>
            <div className="wm-seg"><span>Formato</span><div><button className={watermarkFormat === "full" ? "active" : ""} onClick={() => setWatermarkFormat("full")}>Completo</button><button className={watermarkFormat === "compact" ? "active" : ""} onClick={() => setWatermarkFormat("compact")}>Compacto</button></div></div>
            <div className="wm-seg"><span>Cor do texto</span><div><button className={watermarkTheme === "light" ? "active" : ""} onClick={() => setWatermarkTheme("light")}>Claro</button><button className={watermarkTheme === "dark" ? "active" : ""} onClick={() => setWatermarkTheme("dark")}>Escuro</button></div></div>
            <label className="wm-toggle"><input type="checkbox" checked={watermarkVerified} onChange={(event) => setWatermarkVerified(event.target.checked)} /><span>Selo verificado</span></label>
            <label className="wm-range"><span>Tamanho</span><input type="range" min="16" max="96" step="1" value={watermarkLayout.width} onChange={(event) => setWatermarkLayout((current) => ({ ...current, width: Number(event.target.value) }))} /></label>
            <label className="wm-range"><span>Opacidade {Math.round(watermarkOpacity * 100)}%</span><input type="range" min=".2" max="1" step=".05" value={watermarkOpacity} onChange={(event) => setWatermarkOpacity(Number(event.target.value))} /></label>
            <button className="wm-reset" onClick={() => setWatermarkLayout(DEFAULT_WATERMARK_LAYOUT)}>Reposicionar</button>
            <button className="wm-close danger" onClick={() => setWatermarkEnabled(false)}>Desativar</button>
          </div>}

          {timelineSelection && (
            <div className="timeline-clip-inspector">
              {timelineSelection.kind === "factory" && selectedFactoryClip && <>
                <div className="selected-clip-name factory-selected-name"><span>{selectedFactoryClip.section === "hook" ? "H" : selectedFactoryClip.section === "body" ? "C" : "A"}</span><div><strong>{selectedFactoryClip.section === "hook" ? "Hook" : selectedFactoryClip.section === "body" ? "Corpo" : "CTA"} da Fábrica</strong><small>Fonte {formatTime(selectedFactoryClip.sourceStart || 0)}–{formatTime(selectedFactoryClip.sourceEnd || selectedFactoryClip.duration)} · use as alças azuis</small></div></div>
                <button onClick={() => nudgeFactoryClip(timelineSelection.index, "start", -.1)}>Estender início</button>
                <button onClick={() => nudgeFactoryClip(timelineSelection.index, "start", .1)}>Encurtar início</button>
                <button onClick={() => nudgeFactoryClip(timelineSelection.index, "end", -.1)}>Encurtar fim</button>
                <button onClick={() => nudgeFactoryClip(timelineSelection.index, "end", .1)}>Estender fim</button>
              </>}
              {timelineSelection.kind === "main" && selectedMainSegment && <>
                <div className="selected-clip-name"><span>▶</span><div><strong>Vídeo principal · trecho {timelineSelection.index + 1}</strong><small>{formatTime(selectedMainSegment.start)}–{formatTime(selectedMainSegment.end)}</small></div></div>
                <button onClick={() => seekVideo(selectedMainSegment.start)}>Ir ao início</button>
                <button onClick={() => moveMainSegment(timelineSelection.index, -1)} disabled={timelineSelection.index === 0}>← Mover</button>
                <button onClick={() => moveMainSegment(timelineSelection.index, 1)} disabled={timelineSelection.index === orderedVideoSegments.length - 1}>Mover →</button>
                <button onClick={() => { setCropControlsOpen(true); setTimelineCollapsed(false); setTimelineHeight((current) => Math.max(430, current)); }}>⌗ Crop</button>
                <button onClick={splitMainVideo}>✂ Dividir no cursor</button>
                <button onClick={() => adjustMainSegmentEdge(timelineSelection.index, "start", -.1)} disabled={timelineSelection.index === 0}>Início −0,1s</button>
                <button onClick={() => adjustMainSegmentEdge(timelineSelection.index, "start", .1)} disabled={timelineSelection.index === 0}>Início +0,1s</button>
                <button onClick={() => adjustMainSegmentEdge(timelineSelection.index, "end", -.1)} disabled={timelineSelection.index === videoSegments.length - 1}>Fim −0,1s</button>
                <button onClick={() => adjustMainSegmentEdge(timelineSelection.index, "end", .1)} disabled={timelineSelection.index === videoSegments.length - 1}>Fim +0,1s</button>
                <button className="danger" onClick={() => removeMainSegment(timelineSelection.index)}>Remover trecho</button>
              </>}
              {timelineSelection.kind === "audio" && <>
                <div className="selected-clip-name audio"><span>♪</span><div><strong>Áudio extraído</strong><small>{playbackSpeed}× · acompanha os cortes do vídeo</small></div></div>
                <button onClick={() => seekVideo(0)}>Ir ao início</button>
                <button onClick={() => { pushEditorHistory(); setSettings((current) => ({ ...current, removeAudio: !current.removeAudio })); }}>{settings.removeAudio ? "Ativar áudio" : "Silenciar áudio"}</button>
                <button className="danger" onClick={() => { pushEditorHistory(); setAudioExtracted(false); setTimelineSelection(null); }}>Excluir faixa</button>
              </>}
              {timelineSelection.kind === "imported-audio" && (() => {
                const track = importedAudios.find((item) => item.id === timelineSelection.id);
                if (!track) return null;
                return <>
                  <div className="selected-clip-name imported-audio"><span>♫</span><div><strong>{track.name}</strong><small>Começa em {formatTime(track.offset)} · {formatTime(track.duration)} · toca por cima</small></div></div>
                  <label className="inspector-slider"><span>Volume {Math.round(track.volume * 100)}%</span><input type="range" min="0" max="1" step=".02" value={track.volume} onChange={(event) => updateImportedAudio(track.id, { volume: Number(event.target.value) })} /></label>
                  <label className="inspector-slider"><span>Início {formatTime(track.offset)}</span><input type="range" min="0" max={Math.max(.2, videoDuration)} step=".1" value={Math.min(track.offset, Math.max(.2, videoDuration))} onChange={(event) => updateImportedAudio(track.id, { offset: Number(event.target.value) })} /></label>
                  <button onClick={() => updateImportedAudio(track.id, { offset: 0 })}>Início no 0s</button>
                  <button onClick={() => updateImportedAudio(track.id, { offset: clamp(currentTime, 0, Math.max(.2, videoDuration)) })}>Começar no cursor</button>
                  <button className="danger" onClick={() => removeImportedAudio(track.id)}>Remover áudio</button>
                </>;
              })()}
              {timelineSelection.kind === "ranking" && selectedRankingIndex !== null && <>
                <div className="selected-clip-name ranking"><span>{selectedRankingIndex + 1}–</span><div><strong>{products[selectedRankingIndex]?.name || `Item ${selectedRankingIndex + 1}`}</strong><small>{formatTime(rankingStart(selectedRankingIndex))}–{formatTime(rankingEnd(selectedRankingIndex))} · camada {(rankingSettings.itemLayers[selectedRankingIndex] ?? 0) + 1}</small></div></div>
                <button onClick={() => seekVideo(rankingStart(selectedRankingIndex))}>Ir ao início</button>
                <button onClick={() => moveRankingLayer(selectedRankingIndex, -1)}>↑ Subir camada</button>
                <button onClick={() => moveRankingLayer(selectedRankingIndex, 1)}>↓ Descer camada</button>
                <button onClick={() => duplicateRankingItem(selectedRankingIndex)}>Duplicar</button>
                <button className="danger" onClick={() => removeRankingItem(selectedRankingIndex)}>Excluir</button>
              </>}
              {timelineSelection.kind === "scene" && rankingScenes[timelineSelection.index] && <>
                <div className="selected-clip-name ranking"><span>{timelineSelection.index + 1}</span><div><strong>{rankingScenes[timelineSelection.index].title || `Quadro ${timelineSelection.index + 1}`}</strong><small>{rankingScenes[timelineSelection.index].duration}s · quadro de título</small></div></div>
                <button onClick={() => { setSelectedRankingScene(timelineSelection.index); setActivePanel("edit"); seekVideo(Math.min(rankingSceneStarts[timelineSelection.index] || 0, videoDuration)); }}>Editar</button>
                <button className="danger" disabled={rankingScenes.length <= 1} onClick={() => deleteTimelineTarget({ kind: "scene", index: timelineSelection.index })}>Excluir</button>
              </>}
              {timelineSelection.kind === "broll" && selectedBrollClip && <>
                <div className="selected-clip-name cinema"><span>◫</span><div><strong>{selectedBrollClip.name}</strong><small>{selectedBrollClip.placement === "sequence" ? "Sequência principal" : `Sobreposição · ${formatTime(selectedBrollClip.timelineStart)} · camada ${(selectedBrollClip.layer ?? 0) + 1}`} · {selectedBrollClip.duration.toFixed(1)}s</small></div></div>
                <button onClick={() => seekVideo(selectedBrollClip.timelineStart)}>Ir ao início</button>
                {selectedBrollClip.placement !== "sequence" && <>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayX: 6 })}>← Esquerda</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayX: Math.max(6, 94 - (selectedBrollClip.overlayWidth ?? 40)) })}>Direita →</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayY: 7 })}>↑ Superior</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayY: Math.max(7, 92 - (selectedBrollClip.overlayWidth ?? 40) * 16 / 9) })}>↓ Inferior</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayWidth: Math.max(24, (selectedBrollClip.overlayWidth ?? 40) - 5) })}>Tamanho −</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { overlayWidth: Math.min(76, (selectedBrollClip.overlayWidth ?? 40) + 5) })}>Tamanho +</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { layer: Math.max(0, (selectedBrollClip.layer ?? 0) - 1) })}>↑ Subir camada</button>
                  <button onClick={() => updateBroll(selectedBrollClip.id, { layer: Math.min(9, (selectedBrollClip.layer ?? 0) + 1) })}>↓ Descer camada</button>
                </>}
                <button className="danger" onClick={() => { removeBroll(selectedBrollClip.id); setTimelineSelection(null); }}>Excluir</button>
              </>}
              <button className="close-clip-inspector" onClick={() => setTimelineSelection(null)} aria-label="Fechar ajustes do bloco">×</button>
            </div>
          )}

          <div className="timeline-scroll-area" onWheel={handleTimelineWheel}>
          <div className="timeline-scaled-content" style={{ width: `${timelineZoom * 100}%` }}>
          <div className="timeline-ruler-row">
            <div className="track-label" />
            <div className="timeline-ruler">
              {Array.from({ length: timelineTickCount }, (_, index) => index / (timelineTickCount - 1)).map((position) => (
                <span key={position} style={{ left: `${position * 100}%` }}>{formatTime(videoDuration * position)}</span>
              ))}
            </div>
          </div>

          <div className={`timeline-track-row ${activeFactorySequence ? "factory-main-row" : ""}`}>
            <div className="track-label"><span className="track-icon">▶</span><div><strong>VÍDEO</strong><small>{videoFile.name}</small></div></div>
            {activeFactorySequence ? <div className="timeline-track factory-video-track" onClick={seekFromMainTimeline} aria-label="Clipes vinculados da Fábrica">
              {activeFactorySequence.map((clip, index) => {
                const cleanDuration = Math.max(.1, clip.duration - clip.removedSeconds);
                const sequenceDuration = factorySequenceDuration || 1;
                const left = activeFactorySequence.slice(0, index).reduce((total, item) => total + Math.max(.1, item.duration - item.removedSeconds), 0);
                const label = clip.section === "hook" ? "Hook" : clip.section === "body" ? "Corpo" : "CTA";
                const selected = timelineSelection?.kind === "factory" && timelineSelection.index === index;
                const sourceStart = clip.sourceStart || 0;
                const sampleStart = Math.floor(sourceStart / Math.max(.1, clip.sourceLimitEnd || sourceStart + clip.duration) * waveformSamples.length);
                const sampleEnd = Math.max(sampleStart + 1, Math.ceil((clip.sourceEnd || sourceStart + clip.duration) / Math.max(.1, clip.sourceLimitEnd || sourceStart + clip.duration) * waveformSamples.length));
                return <div key={`${clip.id}-${sourceStart}-${clip.sourceEnd}`} role="button" tabIndex={0} className={`factory-video-clip ${clip.section} ${selected ? "selected" : ""}`} style={{ left: `${left / sequenceDuration * 100}%`, width: `${cleanDuration / sequenceDuration * 100}%` }} onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "factory", index }); seekVideo(left); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setTimelineSelection({ kind: "factory", index }); seekVideo(left); } }} title={`${label}: arraste as bordas para ajustar a fala`}>
                  <span className="factory-clip-head"><b>{label}</b><em>{formatTime(cleanDuration)}</em></span>
                  <span className="factory-clip-thumbnails" aria-hidden="true">{Array.from({ length: Math.max(2, Math.min(8, Math.round(cleanDuration * 1.4))) }, (_, frame) => <i key={frame} style={{ backgroundPosition: `${(frame * 23 + index * 17) % 100}% center` }} />)}</span>
                  {waveformSamples.length > 0 && <span className="real-waveform factory-clip-waveform">{waveformSamples.slice(sampleStart, sampleEnd).map((sample, sampleIndex) => <i key={sampleIndex} className={sample < .075 ? "quiet" : ""} style={{ height: `${Math.max(4, sample * 92)}%` }} />)}</span>}
                  <span className="factory-link-indicator" aria-hidden="true">↔</span>
                  <button className="factory-trim-handle start" aria-label={`Ajustar início do ${label}`} onPointerDown={(event) => beginFactoryTrim(event, index, "start")} onPointerMove={moveFactoryTrim} onPointerUp={endFactoryTrim} onPointerCancel={endFactoryTrim}><i /></button>
                  <button className="factory-trim-handle end" aria-label={`Ajustar fim do ${label}`} onPointerDown={(event) => beginFactoryTrim(event, index, "end")} onPointerMove={moveFactoryTrim} onPointerUp={endFactoryTrim} onPointerCancel={endFactoryTrim}><i /></button>
                </div>;
              })}
            </div> : <div className="timeline-track main-track" onClick={seekFromMainTimeline}>
              {orderedVideoSegments.map((segment, index) => (
                <div
                  key={`${segment.start}-${segment.end}`}
                  role="button"
                  tabIndex={0}
                  className={`main-segment-block ${timelineSelection?.kind === "main" && timelineSelection.index === index ? "selected" : ""}`}
                  style={{ left: `${orderedVideoSegments.slice(0, index).reduce((total, item) => total + item.end - item.start, 0) / (videoDuration || 1) * 100}%`, width: `${Math.max(.5, (segment.end - segment.start) / (videoDuration || 1) * 100)}%` }}
                  draggable
                  onDragStart={(event) => { draggedMainSegmentRef.current = index; event.dataTransfer.effectAllowed = "move"; event.currentTarget.classList.add("dragging"); }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const sourceIndex = draggedMainSegmentRef.current; if (sourceIndex !== null) reorderMainSegment(sourceIndex, index); draggedMainSegmentRef.current = null; }}
                  onDragEnd={(event) => { draggedMainSegmentRef.current = null; event.currentTarget.classList.remove("dragging"); }}
                  onClick={(event) => { event.stopPropagation(); activeMainOrderIndexRef.current = index; setTimelineSelection({ kind: "main", index }); seekVideo(segment.start); }}
                  onContextMenu={(event) => openContextMenu(event, { kind: "main", index })}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activeMainOrderIndexRef.current = index; setTimelineSelection({ kind: "main", index }); seekVideo(segment.start); } }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    const splitTime = (segment.start + segment.end) / 2;
                    splitMainAt(splitTime);
                    seekVideo(splitTime);
                  }}
                  title="Clique para selecionar · arraste para trocar de posição · duplo clique para dividir"
                ><span className="clip-name">{orderedVideoSegments.length === 1 ? "Vídeo principal" : `Vídeo ${index + 1}`}</span><i className="clip-drag-grip">⠿</i>{waveformSamples.length > 0 && <span className="real-waveform clip-waveform" aria-label="Forma de onda real deste trecho">{waveformSamples.slice(Math.floor(segment.start / (videoDuration || 1) * waveformSamples.length), Math.max(1, Math.ceil(segment.end / (videoDuration || 1) * waveformSamples.length))).map((sample, sampleIndex) => <i key={sampleIndex} className={sample < .075 ? "quiet" : ""} style={{ height: `${Math.max(4, sample * 92)}%` }} />)}</span>}{index > 0 && <button className="main-trim-handle start" aria-label={`Ajustar início do vídeo ${index + 1}`} onPointerDown={(event) => beginMainTrim(event, index, "start")} onPointerMove={moveMainTrim} onPointerUp={endMainTrim} onPointerCancel={endMainTrim} />}{index < orderedVideoSegments.length - 1 && <button className="main-trim-handle end" aria-label={`Ajustar fim do vídeo ${index + 1}`} onPointerDown={(event) => beginMainTrim(event, index, "end")} onPointerMove={moveMainTrim} onPointerUp={endMainTrim} onPointerCancel={endMainTrim} />}</div>
              ))}
              {silentRanges.map((range, index) => (
                <button
                  key={`${range.start}-${range.end}`}
                  className={`cut-overlay ${range.origin === "manual" ? "manual" : "automatic"} ${selectedCut === index ? "selected" : ""}`}
                  style={{ left: `${(range.start / (videoDuration || 1)) * 100}%`, width: `${Math.max(.3, ((range.end - range.start) / (videoDuration || 1)) * 100)}%` }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedCut(index);
                    setTimelineSelection({ kind: "removed", index });
                    seekVideo(Math.max(0, range.start - .2));
                  }}
                  onContextMenu={(event) => openContextMenu(event, { kind: "removed", index })}
                  title={`${range.origin === "manual" ? "Corte manual" : "Corte automático"}: ${formatTime(range.start)}–${formatTime(range.end)}`}
                ><span>{range.origin === "manual" ? "Manual" : "Auto"}</span></button>
              ))}
            </div>}
          </div>

          {activeFactoryProject && factoryStructureRanges.length > 0 && <div className="timeline-track-row factory-structure-row">
            <div className="track-label"><span className="track-icon factory-structure">H</span><div><strong>SAFE ZONE</strong><small>Hook · Corpo · CTA</small></div></div>
            <div className="timeline-track factory-structure-track" aria-label="Estrutura do vídeo criado pela Fábrica">
              {factoryStructureRanges.map((range) => {
                const label = range.section === "hook" ? "Hook" : range.section === "body" ? "Corpo" : "CTA";
                return <button key={`${range.section}-${range.start}`} className={`factory-structure-block ${range.section}`} style={{ left: `${range.start / (videoDuration || 1) * 100}%`, width: `${Math.max(1, (range.end - range.start) / (videoDuration || 1) * 100)}%` }} onClick={() => seekVideo(range.start)} title={`${label}: ${formatTime(range.start)}–${formatTime(range.end)}`}><b>{label}</b><span>{formatTime(range.start)}–{formatTime(range.end)}</span></button>;
              })}
            </div>
          </div>}

          {audioExtracted && <div className="timeline-track-row audio-row">
            <div className="track-label"><span className="track-icon audio">♪</span><div><strong>ÁUDIO</strong><small>{settings.removeAudio ? "silenciado" : `extraído · ${playbackSpeed}×`}</small></div></div>
            <button className={`timeline-track extracted-audio-track ${timelineSelection?.kind === "audio" ? "selected" : ""}`} onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "audio" }); }} onContextMenu={(event) => openContextMenu(event, { kind: "audio" })}>
              <span>Áudio de {videoFile.name}</span>
              {waveformSamples.length > 0 && <WaveformCanvas samples={waveformSamples} className="audio-waveform" color="#9cf2b5" quietColor="#f4c94e" />}
            </button>
          </div>}

          {importedAudios.map((track, trackIndex) => (
            <div className="timeline-track-row imported-audio-row" key={track.id}>
              <div className="track-label"><span className="track-icon imported-audio">♫</span><div><strong>{importedAudios.length > 1 ? `ÁUDIO ${trackIndex + 1}` : "ÁUDIO IMPORTADO"}</strong><small>{Math.round(track.volume * 100)}% · começa em {formatTime(track.offset)}</small></div></div>
              <div className="timeline-track imported-audio-track" onClick={seekFromTimeline}>
                <div
                  className={`imported-audio-clip ${timelineSelection?.kind === "imported-audio" && timelineSelection.id === track.id ? "selected" : ""}`}
                  style={{ left: `${clamp(track.offset / (videoDuration || 1), 0, 1) * 100}%`, width: `${clamp((track.duration || videoDuration) / (videoDuration || 1), .02, 1) * 100}%` }}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginImportedAudioDrag(event, track.id)}
                  onPointerMove={moveImportedAudioDrag}
                  onPointerUp={endImportedAudioDrag}
                  onPointerCancel={endImportedAudioDrag}
                  onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "imported-audio", id: track.id }); }}
                  onContextMenu={(event) => openContextMenu(event, { kind: "imported-audio", id: track.id })}
                  title={`${track.name} · começa em ${formatTime(track.offset)} · arraste para mover`}
                >
                  <span className="imported-audio-name">♫ {track.name}</span>
                  {track.samples.length > 0 && <WaveformCanvas samples={track.samples} className="imported-audio-waveform" color="#c9a6ff" quietColor="#6f5f9c" />}
                </div>
              </div>
            </div>
          ))}

          {templateMode === "ranking" && (
            <div className="timeline-track-row ranking-scenes-row">
              <div className="track-label"><span className="track-icon scenes">T</span><div><strong>QUADROS</strong><small>{rankingScenes.length} {rankingScenes.length === 1 ? "título" : "títulos"} · {rankingScenes.reduce((total, scene) => total + scene.duration, 0)}s</small></div></div>
              <div className="timeline-track ranking-scenes-track">
                {rankingScenes.map((scene, index) => (
                  <button
                    key={scene.id}
                    className={`ranking-scene-block ${selectedRankingScene === index ? "selected" : ""}`}
                    style={{
                      left: `${Math.min(100, (rankingSceneStarts[index] || 0) / (videoDuration || 1) * 100)}%`,
                      width: `${Math.max(1.5, Math.min(100, scene.duration / (videoDuration || 1) * 100))}%`,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedRankingScene(index);
                      setTimelineSelection({ kind: "scene", index });
                      setActivePanel("edit");
                      seekVideo(Math.min(rankingSceneStarts[index] || 0, videoDuration));
                    }}
                    onContextMenu={(event) => openContextMenu(event, { kind: "scene", index })}
                    title={`${scene.title} · ${scene.duration}s`}
                  ><b>{index + 1}</b><span>{scene.title || `Quadro ${index + 1}`}</span><small>{scene.duration}s</small></button>
                ))}
              </div>
            </div>
          )}

          {templateMode === "timed-ranking" && (
            <div className="timeline-track-row ranking-row" style={{ height: `${rankingTrackHeight}px` }}>
              <div className="track-label"><span className="track-icon ranking">1–</span><div><strong>RANKING</strong><small>{rankingSettings.revealMode === "all" ? "entrada conjunta" : `${rankingSettings.count} entradas`}</small></div></div>
              <div className="timeline-track ranking-track" onClick={seekFromTimeline}>
                {visibleProducts.map((product, index) => (
                  <div
                    key={index}
                    className={`ranking-timeline-block ${timelineSelection?.kind === "ranking" && timelineSelection.index === index ? "selected" : ""}`}
                    style={{
                      left: `${Math.min(100, Math.max(0, rankingStart(index) / (videoDuration || 1) * 100))}%`,
                      width: `${Math.max(1.4, (rankingEnd(index) - rankingStart(index)) / (videoDuration || 1) * 100)}%`,
                      top: `${(rankingSettings.itemLayers[index] ?? index) * 25 + 3}px`,
                    }}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "ranking", index }, "move")}
                    onPointerMove={moveTimelineClip}
                    onPointerUp={endTimelineClipDrag}
                    onPointerCancel={endTimelineClipDrag}
                    onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "ranking", index }); setActivePanel("edit"); }}
                    onContextMenu={(event) => openContextMenu(event, { kind: "ranking", index })}
                    title="Arraste para reposicionar; mova para cima ou para baixo para trocar a camada"
                  >
                    <button className="clip-trim-handle start" aria-label={`Ajustar início do item ${index + 1}`} onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "ranking", index }, "trim-start")} onPointerMove={moveTimelineClip} onPointerUp={endTimelineClipDrag} onPointerCancel={endTimelineClipDrag} />
                    <b>{index + 1}–</b><span>{product.name}</span><small>{formatTime(rankingStart(index))}</small>
                    <button className="clip-trim-handle end" aria-label={`Ajustar fim do item ${index + 1}`} onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "ranking", index }, "trim-end")} onPointerMove={moveTimelineClip} onPointerUp={endTimelineClipDrag} onPointerCancel={endTimelineClipDrag} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="timeline-track-row removed-row">
            <div className="track-label"><span className="track-icon removed">×</span><div><strong>REMOVIDOS</strong><small>{silentRanges.length + factoryRemovedRanges.length} trechos · {(removedSeconds + factoryRemovedRanges.reduce((total, range) => total + range.duration, 0)).toFixed(1)}s</small></div></div>
            <div className="timeline-track removed-track">
              {silentRanges.length === 0 && factoryRemovedRanges.length === 0 && <span className="empty-track">Nenhum trecho removido</span>}
              {silentRanges.map((range, index) => (
                <button
                  key={`${range.start}-${range.end}-removed`}
                  className={`removed-clip ${selectedCut === index ? "selected" : ""}`}
                  style={{ left: `${(range.start / (videoDuration || 1)) * 100}%`, width: `${Math.max(1.3, ((range.end - range.start) / (videoDuration || 1)) * 100)}%` }}
                  onClick={() => { setTimelineSelection({ kind: "removed", index }); previewRemovedCut(index); }}
                  title="Clique para ouvir e revisar o trecho removido"
                >{(range.end - range.start).toFixed(1)}s</button>
              ))}
              {factoryRemovedRanges.map((range, index) => (
                <button
                  key={`factory-removed-${index}`}
                  className="removed-clip factory-removed"
                  style={{ left: `${(range.at / (videoDuration || 1)) * 100}%`, width: `${Math.max(.35, (range.duration / (videoDuration || 1)) * 100)}%` }}
                  onClick={() => { seekVideo(range.at); setToast(`${range.duration.toFixed(1)}s removidos no ${range.section === "hook" ? "Hook" : range.section === "body" ? "Corpo" : "CTA"}`); }}
                  title={`Removido na Fábrica: ${range.sourceStart.toFixed(2)}s–${range.sourceEnd.toFixed(2)}s`}
                >Fábrica · {range.duration.toFixed(1)}s</button>
              ))}
            </div>
          </div>

          <div className="timeline-track-row broll-row" style={{ height: `${brollTrackHeight}px` }}>
            <div className="track-label"><span className="track-icon broll">◫</span><div><strong>SOBREPOSIÇÃO</strong><small>{overlayVideoClips.length} vídeos · arraste no tempo</small></div></div>
            <div className="timeline-track broll-track" onClick={seekFromTimeline}>
              {overlayVideoClips.length === 0 && <span className="empty-track">Nenhum vídeo sobreposto</span>}
              {overlayVideoClips.map((clip) => (
                <div
                  key={`${clip.id}-timeline`}
                  className={`broll-timeline-clip ${timelineSelection?.kind === "broll" && timelineSelection.id === clip.id ? "selected" : ""}`}
                  style={{ left: `${(clip.timelineStart / (videoDuration || 1)) * 100}%`, width: `${Math.max(2, (clip.duration / (videoDuration || 1)) * 100)}%`, top: `${(clip.layer ?? 0) * 25 + 3}px` }}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "broll", id: clip.id }, "move")}
                  onPointerMove={moveTimelineClip}
                  onPointerUp={endTimelineClipDrag}
                  onPointerCancel={endTimelineClipDrag}
                  onClick={(event) => { event.stopPropagation(); setTimelineSelection({ kind: "broll", id: clip.id }); seekVideo(clip.timelineStart); setActivePanel("broll"); }}
                  onContextMenu={(event) => openContextMenu(event, { kind: "broll", id: clip.id })}
                  title={`${clip.name}: ${formatTime(clip.sourceStart)} · ${SOUND_EFFECTS.find((effect) => effect.id === clip.sfx)?.name}`}
                >
                  <button className="clip-trim-handle start" aria-label={`Ajustar início de ${clip.name}`} onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "broll", id: clip.id }, "trim-start")} onPointerMove={moveTimelineClip} onPointerUp={endTimelineClipDrag} onPointerCancel={endTimelineClipDrag} />
                  <span>{clip.name}</span><small>♪ {SOUND_EFFECTS.find((effect) => effect.id === clip.sfx)?.name}</small>
                  <button className="clip-trim-handle end" aria-label={`Ajustar fim de ${clip.name}`} onPointerDown={(event) => beginTimelineClipDrag(event, { kind: "broll", id: clip.id }, "trim-end")} onPointerMove={moveTimelineClip} onPointerUp={endTimelineClipDrag} onPointerCancel={endTimelineClipDrag} />
                </div>
              ))}
            </div>
          </div>

          <div className="timeline-playhead-layer" aria-label="Cursor de reprodução arrastável">
            {timelineMarkers.map((marker) => <button key={marker.id} className="timeline-marker" style={{ left: `${videoDuration ? marker.time / videoDuration * 100 : 0}%`, "--marker-color": marker.color } as React.CSSProperties} onClick={(event) => { event.stopPropagation(); seekMainTimelineTime(marker.time); }} onDoubleClick={(event) => { event.stopPropagation(); pushEditorHistory(); setTimelineMarkers((current) => current.filter((item) => item.id !== marker.id)); setToast("Marcador removido"); }} title={`${marker.label} · ${formatTime(marker.time)} · duplo clique para excluir`}><span>{marker.label}</span></button>)}
            <button
              className="timeline-global-playhead"
              style={{ left: `${videoDuration ? (mainTimelineCurrentTime / videoDuration) * 100 : 0}%` }}
              onPointerDown={beginPlayheadDrag}
              onPointerMove={movePlayheadDrag}
              onPointerUp={endPlayheadDrag}
              onPointerCancel={endPlayheadDrag}
              aria-label={`Cursor em ${formatTime(currentTime)}. Arraste para navegar.`}
            ><i /></button>
          </div>
          </div>
          </div>

          {selectedCut !== null && silentRanges[selectedCut] && (
            <div className="cut-editor">
              <div><span className="yellow-dot" /><strong>{silentRanges[selectedCut].origin === "manual" ? "Corte manual" : "Corte automático"} {selectedCut + 1}</strong><small>{formatTime(silentRanges[selectedCut].start)} até {formatTime(silentRanges[selectedCut].end)}</small></div>
              <div className="edge-controls"><span>Início</span><button onClick={() => adjustCut(selectedCut, "start", -.1)}>−0,1s</button><button onClick={() => adjustCut(selectedCut, "start", .1)}>+0,1s</button></div>
              <div className="edge-controls"><span>Fim</span><button onClick={() => adjustCut(selectedCut, "end", -.1)}>−0,1s</button><button onClick={() => adjustCut(selectedCut, "end", .1)}>+0,1s</button></div>
              <button className="review-button" onClick={() => previewRemovedCut(selectedCut)}>▶ Ouvir removido</button>
              <button className="restore-button" onClick={() => restoreCut(selectedCut)}>↩ Restaurar trecho</button>
            </div>
          )}
        </section>
      )}
      {contextMenu && (
        <div
          className="timeline-context-menu"
          style={{ left: `${Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 190)}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
        >
          <div className="context-menu-title">{contextTargetLabel(contextMenu.target)}</div>
          {contextMenuActions(contextMenu.target).map((action, index) => (
            <button key={index} className={action.danger ? "danger" : ""} onClick={action.onClick} role="menuitem">{action.label}</button>
          ))}
        </div>
      )}
      {toast && <div className="toast">✓ {toast}</div>}
      {showExportDialog && !exporting && (
        <div className="export-overlay export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(event) => event.target === event.currentTarget && setShowExportDialog(false)}>
          <div>
            <button className="export-close" onClick={() => setShowExportDialog(false)} aria-label="Fechar">×</button>
            <span className="eyebrow">Qualidade final</span>
            <strong id="export-title">Escolha a resolução</strong>
            <p>Todos os formatos são verticais 9:16 e serão exportados nas dimensões indicadas.</p>
            <div className="export-presets" role="radiogroup" aria-label="Resolução do vídeo">
              {(Object.entries(EXPORT_PRESETS) as Array<[ExportPresetId, typeof EXPORT_PRESETS[ExportPresetId]]>).map(([id, preset]) => (
                <button key={id} className={exportPresetId === id ? "active" : ""} role="radio" aria-checked={exportPresetId === id} onClick={() => setExportPresetId(id)}>
                  <span><b>{preset.name}</b>{id === "full-hd" && <em>Recomendado</em>}</span>
                  <strong>{preset.width} × {preset.height}</strong>
                  <small>{preset.note}</small>
                </button>
              ))}
            </div>
            <div className="export-source-note"><span>Vídeo original</span><b>{videoRef.current?.videoWidth || 0} × {videoRef.current?.videoHeight || 0}</b></div>
            <button className="button primary export-confirm" onClick={() => (scenes.length > 1 ? exportSuperContent() : exportVideo())}>{scenes.length > 1 ? `Exportar super conteúdo (${scenes.length} cenas)` : `Exportar em ${EXPORT_PRESETS[exportPresetId].name}`}</button>
            <small className="export-hint">{scenes.length > 1 ? "As cenas serão unidas em sequência num único vídeo." : "HD é a opção mais leve. 2K e 4K usam mais memória e podem demorar mais."}</small>
          </div>
        </div>
      )}
      {exporting && <div className="export-overlay"><div><span className="spinner" /><strong>Exportando em {EXPORT_PRESETS[exportPresetId].name}</strong><p>{EXPORT_PRESETS[exportPresetId].width} × {EXPORT_PRESETS[exportPresetId].height} · {EXPORT_PRESETS[exportPresetId].fps} fps. Mantenha esta aba aberta.</p><progress value={exportProgress} max="100" /><small className="export-progress-label">{exportProgress}% concluído</small></div></div>}
      {factoryExporting && <div className="export-overlay"><div><span className="spinner" /><strong>{factoryExportStatus}</strong><p>Combinando Hook → Corpo → CTA, removendo pausas e equilibrando o volume em {EXPORT_PRESETS[exportPresetId].name}.</p><progress value={factoryExportProgress} max="100" /><small className="export-progress-label">{factoryExportProgress}% do lote concluído</small></div></div>}
      {factoryPreparing && <div className="export-overlay"><div><span className="spinner" /><strong>{factoryExportStatus || "Preparando vídeo para o editor"}</strong><p>Unindo Hook, Corpo e CTA, aplicando os cortes automáticos e carregando uma variação por vez.</p><small className="export-progress-label">Mantenha esta aba aberta.</small></div></div>}
    </main>
  );
}
