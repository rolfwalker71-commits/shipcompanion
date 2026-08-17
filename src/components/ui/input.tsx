import * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const empty = props.value === undefined ? !props.defaultValue : String(props.value ?? '') === ''
  return (
    <input
      type={type}
      data-slot="input"
      data-empty={empty ? 'true' : 'false'}
      className={cn(
        'flex h-11 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
