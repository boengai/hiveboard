import type { AvatarProps } from '@/types'
import { hashToBg, hashToColor, tv } from '@/utils'

const avatar = tv({
  base: 'inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase',
  defaultVariants: { size: 'md' },
  variants: {
    size: {
      md: 'size-6 text-body-xs',
      sm: 'size-5 text-[10px]',
    },
  },
})

export const Avatar = ({
  fullName = false,
  name,
  size = 'md',
}: AvatarProps) => {
  const fg = hashToColor(name)
  const bg = hashToBg(name)
  return (
    <div className="flex items-center gap-0.5">
      <span
        className={avatar({ size })}
        style={{ backgroundColor: bg, color: fg }}
        title={name}
      >
        {name.charAt(0)}
      </span>
      {fullName && (
        <span className="text-body-xs text-text-secondary">{name}</span>
      )}
    </div>
  )
}
