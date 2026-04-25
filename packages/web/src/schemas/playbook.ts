import { z } from 'zod'

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED_PREFIX = 'playbook:'

const jsonObjectString = z.string().refine(
  (v) => {
    if (!v.trim()) return true
    try {
      JSON.parse(v)
      return true
    } catch {
      return false
    }
  },
  { message: 'Must be valid JSON' },
)

export const playbookFormSchema = z.object({
  allowedTools: z.string(),
  defaultsJson: jsonObjectString,
  description: z.string(),
  displayName: z.string(),
  name: z
    .string()
    .regex(NAME_RE, 'Name must match /^[a-z0-9]+(-[a-z0-9]+)*$/')
    .refine((v) => !v.startsWith(RESERVED_PREFIX), {
      message: `Name must not start with the reserved prefix "${RESERVED_PREFIX}"`,
    }),
  promptTemplate: z.string(),
})

export type PlaybookFormValues = z.infer<typeof playbookFormSchema>
