import { createTV, cnMerge as cnMergeFn, type TVConfig } from 'tailwind-variants'

const twMergeConfig: TVConfig = {
  twMerge: true,
  twMergeConfig: {
    extend: {
      classGroups: {
        'font-size': [
          { text: [{ body: ['xs', 'sm', 'lg', 'xl'], heading: ['1', '2', '3', '4', '5', '6'] }] },
        ],
      },
    },
  },
}

export const cnMerge = (...classes: Array<string>) => cnMergeFn(classes)(twMergeConfig)
export const tv = createTV(twMergeConfig)
