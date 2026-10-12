"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { cn } from "@/lib/utils"
// IMP-28-DS: иконки вариантов всплывающих уведомлений (lucide-react)
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react"

type VariantKey = "default" | "success" | "warning" | "info" | "destructive"

// IMP-28-DS: карта «вариант → иконка + tint-кружок + цвет полоски-акцента».
// Все tint-классы с dark-парами; у destructive — белый tint поверх красного фона.
const VARIANT_META: Record<
  VariantKey,
  { Icon: LucideIcon; iconWrap: string; bar: string }
> = {
  default: {
    Icon: Bell,
    iconWrap: "bg-primary/10 text-primary dark:bg-primary/15",
    bar: "bg-primary/70",
  },
  success: {
    Icon: CheckCircle2,
    iconWrap: "bg-primary/15 text-primary dark:bg-primary/20",
    bar: "bg-primary",
  },
  warning: {
    Icon: AlertTriangle,
    iconWrap:
      "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  info: {
    Icon: Info,
    iconWrap:
      "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400",
    bar: "bg-teal-500",
  },
  destructive: {
    Icon: XCircle,
    iconWrap: "bg-white/15 text-white dark:bg-white/15",
    bar: "bg-destructive",
  },
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    // IMP-28-DS: дефолтный duration=5000 (был Infinity) — тосты не висят вечно;
    // явный duration в call-site (toast({ duration })) перебивает дефолт
    <ToastProvider duration={5000}>
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        variant,
        ...props
      }) {
        const meta = VARIANT_META[variant ?? "default"]
        return (
          <Toast key={id} variant={variant} {...props}>
            {/* IMP-28-DS: цветная вертикальная полоска-акцент слева (3px) по варианту */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 w-[3px] rounded-full",
                meta.bar
              )}
            />
            <div className="flex items-start gap-3">
              {/* IMP-28-DS: иконка варианта в тонированном кружке (декоративная) */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                  meta.iconWrap
                )}
              >
                <meta.Icon className="size-3.5" />
              </span>
              <div className="grid gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
