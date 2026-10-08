// Types for scripts/gen-tokens.mjs, so the tests (TypeScript) can import it.
export interface SpringToken {
  damping: number
  stiffness: number
}

export interface RoleDef {
  light: string
  dark: string
  note?: string
}

export type ContrastBackground = string | { tint: string; alpha: number; over: string }

export interface ContrastRule {
  name: string
  fg: string
  bg: ContrastBackground[]
  min: number
}

export interface DesignTokens {
  contractVersion: number
  roles: Record<string, RoleDef>
  css: { aliases: Record<string, string>; rawVar: string[] }
  contrast: { rules: ContrastRule[] }
  labelChip: { tintAlpha: number }
  type: Record<string, unknown>
  radius: Record<string, unknown>
  motion: Record<string, any>
  [key: string]: unknown
}

export interface TailwindTokenTheme {
  colors: Record<string, string>
  fontSize: Record<string, [string, Record<string, string>]>
  borderRadius: Record<string, string>
  opacity: Record<string, string>
}

export const FIXTURE_PATH: string
export const OUTPUT_PATH: string
export function loadTokens(path?: string): DesignTokens
export function cssVar(tokens: DesignTokens, role: string): string
export function isRawRole(tokens: DesignTokens, role: string): boolean
export function channels(hex: string): string
export function springPosition(damping: number, stiffness: number, seconds: number): number
export function springCurve(spring: SpringToken, ms: number, intervals?: number): string
export function typeRoles(tokens: DesignTokens): Record<string, { size: number; weight: number; line?: number }>
export function radiusRoles(tokens: DesignTokens): Record<string, string>
export function motionVars(tokens: DesignTokens): [string, string][]
export function generateTokensCss(tokens: DesignTokens): string
export function tintOpacities(tokens: DesignTokens): Record<string, string>
export function tailwindTheme(tokens: DesignTokens): TailwindTokenTheme
