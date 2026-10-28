// Messages between the Workshop and pkg/render/assets/bridge.js, which runs
// inside previews on the sandbox domain. Every message carries slop: 1. The
// bridge posts only to the Workshop's origin; the Workshop checks that a
// message comes from its own iframe and from a sandbox origin.

export interface Pin { id: string; n: number; selector: string; fx?: number; fy?: number; resolved: boolean; title: string }

// Workshop → preview
export type ToPreview =
  | { slop: 1; type: 'pick'; on: boolean }
  | { slop: 1; type: 'pins'; pins: Pin[]; focus: string | null }
  | { slop: 1; type: 'focus'; id: string }

export interface PickMessage {
  type: 'pick'
  selector: string
  tag: string
  text: string
  fx: number
  fy: number
  box: [number, number, number, number]
  styles: Record<string, string>
}

// preview → Workshop
export type FromPreview =
  | PickMessage
  | { type: 'pin'; id: string }
  | { type: 'pins'; found: string[]; missing: string[] }
  | { type: 'ready'; title: string }
  | { type: 'nav'; href: string }
  | { type: 'external'; href: string }
