import * as React from 'react'

export function Card({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['rounded-lg border bg-card text-card-foreground shadow-sm', className].join(' ')}
      {...props}
    />
  )
}

export function CardHeader({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={['flex flex-col space-y-1.5 p-4', className].join(' ')} {...props} />
}

export function CardTitle({ className = '', ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={['font-semibold leading-none tracking-tight text-sm', className].join(' ')} {...props} />
}

export function CardContent({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={['p-4 pt-0', className].join(' ')} {...props} />
}
