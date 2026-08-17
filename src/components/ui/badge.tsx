import * as React from 'react'
import { cn } from '@/lib/utils'

function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex w-max max-w-full shrink-0 items-center overflow-visible rounded-full bg-muted px-3 py-1 text-sm font-medium leading-snug whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }
