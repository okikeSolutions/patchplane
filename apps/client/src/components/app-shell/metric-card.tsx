import type { ComponentType } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  readonly title: string
  readonly value: string
  readonly detail: string
  readonly icon: ComponentType
}) {
  return (
    <Card id={title.toLowerCase().replaceAll(' ', '-')}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
        <CardAction>
          <Icon />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-medium tracking-[-0.04em]">{value}</div>
      </CardContent>
    </Card>
  )
}
