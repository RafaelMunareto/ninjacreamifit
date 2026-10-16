import { useEffect, useRef, type ReactNode } from "react"

export default function Modal({
  children,
  titleId,
  onClose,
  wide = false,
}: {
  children: ReactNode
  titleId: string
  onClose: () => void
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    panel.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current()
      if (event.key !== "Tab") return
      const elements = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      )
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first) {
        event.preventDefault()
        return
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onKeyDown)
      previousFocus?.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#211914]/70 p-4 backdrop-blur-sm max-sm:p-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`max-h-[92dvh] min-w-0 w-full overflow-y-auto rounded-[32px] bg-[#fffaf3] shadow-2xl outline-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none ${
          wide ? "max-w-3xl" : "max-w-2xl"
        }`}
      >
        {children}
      </div>
    </div>
  )
}
