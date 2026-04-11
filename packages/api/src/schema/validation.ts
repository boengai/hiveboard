import { z } from 'zod/v4'

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a valid hex color (e.g. #e53e3e)')
