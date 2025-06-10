"use client"

import { useState, useEffect } from "react"
import { HistoryView } from "./history-view"

export default function HistoryPage() {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) return null

    return (
        <main className="relative flex h-full flex-col bg-background">
            <div className="flex-1 overflow-auto p-4">
                <h1 className="mb-4 text-xl font-bold">Transaction History</h1>
                <HistoryView />
            </div>
        </main>
    )
}
