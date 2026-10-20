import { useEffect, useId, useRef, useState } from "react"
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser"
import { normalizeFoodBarcode } from "../lib/nutrition.js"
import Modal from "./Modal"

export default function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (barcode: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  onScanRef.current = onScan
  onCloseRef.current = onClose
  const [error, setError] = useState("")
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let active = true
    let controls: IScannerControls | undefined
    const stop = () => {
      controls?.stop()
      const stream = video.srcObject
      if (typeof MediaStream !== "undefined" && stream instanceof MediaStream)
        stream.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
    const reader = new BrowserMultiFormatReader(
      new Map<number, unknown>([
        [3, true],
        [
          2,
          [
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.ITF,
          ],
        ],
      ]) as never,
      { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 500 },
    )
    void reader
      .decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        video,
        (result, _error, scanner) => {
          if (!active) return
          const barcode = normalizeFoodBarcode(result?.getText() || "")
          if (!barcode) return
          active = false
          scanner.stop()
          stop()
          onScanRef.current(barcode)
        },
      )
      .then((scanner) => {
        controls = scanner
        if (!active) stop()
      })
      .catch(() => {
        if (!active) return
        stop()
        setError(
          "Não foi possível acessar a câmera. Permita o acesso no navegador ou digite o código manualmente.",
        )
      })
    const hide = () => {
      if (document.hidden) {
        active = false
        stop()
        onCloseRef.current()
      }
    }
    document.addEventListener("visibilitychange", hide)
    return () => {
      active = false
      stop()
      document.removeEventListener("visibilitychange", hide)
    }
  }, [])
  return (
    <Modal titleId={titleId} onClose={onClose}>
      <div className="space-y-5 p-5 sm:p-7">
        <h2 id={titleId} className="font-display text-xl font-black">
          Ler código de barras
        </h2>
        <p className="text-sm text-muted">
          Aponte a câmera para o código na embalagem.
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-pink-soft p-4 text-sm">
            {error}
          </p>
        )}
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-[4/3] w-full object-cover"
            aria-label="Câmera para leitura do código de barras"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-[10%] top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-[#b8e46c]"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-12 w-full rounded-xl border border-outline px-4 py-3 font-bold"
        >
          Fechar câmera
        </button>
      </div>
    </Modal>
  )
}
