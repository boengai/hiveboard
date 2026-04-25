import { z } from 'zod'

const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/

export const secretNameSchema = z
  .string()
  .min(1, 'Name is required.')
  .regex(SECRET_NAME_RE, 'Name must be UPPER_SNAKE (e.g. API_KEY).')

export const secretAddFormSchema = z.object({
  description: z.string(),
  name: secretNameSchema,
  value: z.string().min(1, 'Value is required.'),
})

export const secretUpdateValueSchema = z.object({
  value: z.string().min(1, 'Value is required.'),
})

export const taskSecretRequireSchema = z.object({
  name: secretNameSchema,
})

export type SecretAddFormValues = z.infer<typeof secretAddFormSchema>
export type SecretUpdateValueValues = z.infer<typeof secretUpdateValueSchema>
export type TaskSecretRequireValues = z.infer<typeof taskSecretRequireSchema>
