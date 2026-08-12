/**
 * Save the current instrument frame.
 *
 * The image is written with a label bar carrying what a real product would be
 * identified by — instrument, sol, local time, field of view, filter — because
 * a frame without that is a screenshot, not an observation.
 */

export interface CaptureRequest {
  pending: boolean;
  label: { instrument: string; sol: number; ltst: string; fov: string; filter: string };
  onReady: ((dataUrl: string) => void) | null;
  deliver: (src: HTMLCanvasElement, w: number, h: number) => void;
}

const BAR = 46;

export const capture: CaptureRequest = {
  pending: false,
  label: { instrument: "", sol: 0, ltst: "", fov: "", filter: "" },
  onReady: null,
  deliver(src, w, h) {
    capture.pending = false;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h + BAR;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0b0705";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);

    const { instrument, sol, ltst, fov, filter } = capture.label;
    ctx.fillStyle = "#f0d4b4";
    ctx.font = "600 15px ui-monospace, monospace";
    ctx.fillText(`${instrument}`, 14, h + 20);
    ctx.fillStyle = "#a87d5e";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`SOL ${sol}  ·  ${ltst} LTST  ·  ${fov}${filter ? `  ·  ${filter}` : ""}`, 14, h + 37);
    ctx.fillStyle = "#6d5241";
    ctx.font = "11px ui-monospace, monospace";
    const credit = "GALE CRATER  ·  4.59°S 137.44°E  ·  terrain from MOLA";
    ctx.fillText(credit, w - ctx.measureText(credit).width - 14, h + 30);

    capture.onReady?.(out.toDataURL("image/png"));
    capture.onReady = null;
  },
};
