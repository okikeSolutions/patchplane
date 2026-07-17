import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '@/routes/index'

export const Route = createFileRoute('/')({ component: LandingPage })
