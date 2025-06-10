"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import DirectInput from "./direct-input"
import CategoryBadge from "./category-badges"
import ExpenseModal from "./expense-modal"
import { formatDistanceToNow } from "date-fns"
import {
  createTransactionFromTextAction,
  getTransactionsAction,
  deleteTransactionAction,
  updateTransactionAction,
  getLatestTransactionsAction
} from "@/app/actions"
import { getBestLocale } from "@/app/utils"
import { ChevronRight, ChevronUp, ChevronDown, PieChart, Loader2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/app/constants"
import { useAutoAnimate } from "@formkit/auto-animate/react";
import CountUp from "react-countup";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import LatestTransaction from "./latest-transaction"

type Expense = {
  id: string
  name: string
  description: string
  category: string
  amount: number
  currency: string
  convertedAmount: number
  convertedCurrency: string
  createdAt: string
}

const useTransactionsQuery = (selectedCategory: string, sortOrder: string) => {
  return useQuery({
    queryKey: ['transactions', selectedCategory, sortOrder],
    queryFn: async () => {
      const result = await getTransactionsAction();
      const filtered = result.data
        .filter(tx => {
          const date = new Date(tx.createdAt);
          const now = new Date();
          return (
            date.getDate() === now.getDate() &&
            date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear()
          );
        })
        .filter(tx => selectedCategory === 'all' || tx.category === selectedCategory)
        .sort((a, b) => {
          if (sortOrder === 'asc') return a.amount - b.amount;
          if (sortOrder === 'desc') return b.amount - a.amount;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .map(tx => ({
          ...tx,
          description: tx.description || '',
          createdAt: tx.createdAt.toISOString(),
          convertedAmount: tx.convertedAmount,
          convertedCurrency: tx.convertedCurrency,
        }));

      return filtered;
    },
  });
};

const useTransactionFilters = () => {
  const queryClient = useQueryClient();

  const filtersQuery = useQuery({
    queryKey: ['transactionFilters'],
    queryFn: () => ({ category: 'all', sort: 'newest' }),
    staleTime: Infinity,
    initialData: { category: 'all', sort: 'newest' },
  });

  const setFilters = (newFilters: { category?: string; sort?: string }) => {
    queryClient.setQueryData(['transactionFilters'], (old: any) => ({
      ...old,
      ...newFilters,
    }));
  };

  return {
    filters: filtersQuery.data,
    setFilters,
  };
};

export default function HomeTab() {
  const [text, setText] = useState("")
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [parent] = useAutoAnimate();  // animation
  const { filters, setFilters } = useTransactionFilters();

  const queryClient = useQueryClient();

  const { data: filteredTransactions, isLoading, status } = useTransactionsQuery(filters.category, filters.sort);

  // mutation
  const mutation = useMutation({
    mutationFn: createTransactionFromTextAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTransactionAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    }
  })

  const updateMutation = useMutation({
    mutationFn: updateTransactionAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    }
  })

  const uniqueCategories = Array.from(new Set(filteredTransactions?.map(tx => tx.category)))

  const totalSpent = filteredTransactions?.reduce((sum, tx) => sum + tx.convertedAmount, 0)

  const categoryMap = new Map<string, number>()
  filteredTransactions?.forEach(tx => {
    categoryMap.set(tx.category, (categoryMap.get(tx.category) || 0) + tx.convertedAmount)
  })
  const categoryTotals = Array.from(categoryMap.entries()).map(([category, amount]) => ({
    category,
    amount,
    percentage: totalSpent ? Math.round((amount / totalSpent) * 100) : 0
  }))

  const getCategoryBarColor = (category: string) => {
    const colors: Record<string, string> = {
      Food: CATEGORY_COLORS.Food,
      Transportation: CATEGORY_COLORS.Transportation,
      Shopping: CATEGORY_COLORS.Shopping,
      "Health and Fitness": CATEGORY_COLORS["Health and Fitness"],
      Entertainment: CATEGORY_COLORS.Entertainment,
      Education: CATEGORY_COLORS.Education,
      Utilities: CATEGORY_COLORS.Utilities,
      Other: CATEGORY_COLORS.Other,
    }
    return colors[category] || "bg-gray-400"
  }

  return (
    <div className="space-y-6">
      <DirectInput inputText={text} setInputText={setText} onSubmit={async () => {
        await mutation.mutateAsync(text)
        setText("")
      }} />

      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <Select value={filters.category} onValueChange={val => setFilters({ category: val })} disabled={status === 'pending'}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {uniqueCategories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.sort} onValueChange={val => setFilters({ sort: val })} disabled={status === 'pending'}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Low to High</SelectItem>
            <SelectItem value="desc">High to Low</SelectItem>
            <SelectItem value="newest">Latest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-none shadow-sm transition-all duration-200 cursor-pointer mt-4" onClick={() => setIsExpanded(!isExpanded)}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Today's Overview</CardTitle>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-2xl font-bold">
                {!filteredTransactions?.length ? "No transactions" : (
                  <CountUp
                    start={0}
                    end={totalSpent || 0}
                    duration={0.5}
                    separator=","
                    decimals={2}
                    prefix={new Intl.NumberFormat(getBestLocale(), {
                      style: "currency",
                      currency: filteredTransactions?.[0]?.convertedCurrency,
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }).format(0).replace(/\d/g, "")} // ambil prefix mata uang (misalnya "$", "Rp")
                  />
                )}
              </p>
              <p className="text-sm text-muted-foreground">spent today</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium animate-pulse">{filteredTransactions?.length || 0} transactions</p>
            </div>
          </div>

          {isExpanded && (
            <div className="mt-4 space-y-3 pt-3 border-t">
              <div className="flex items-center gap-2">
                <PieChart className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Category Breakdown</p>
              </div>

              {categoryTotals.map((category, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{CATEGORY_ICONS[category.category as keyof typeof CATEGORY_ICONS]} {category.category}</span>
                    <span>
                      {category.amount.toLocaleString(getBestLocale(), {
                        style: "currency",
                        currency: filteredTransactions?.[0]?.convertedCurrency || "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} ({category.percentage}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${getCategoryBarColor(category.category)}`}
                      style={{ width: `${category.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div ref={parent} className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold mb-2 mt-4">
            <span>Today's Expenses</span>
          </h2>
          {isLoading && (
            <Loader2 className="animate-spin" />
          )}
        </div>
        {/* if no transactions in box style */}
        {!isLoading && (filteredTransactions?.length ?? 0) === 0 && (
          <Card className="border-dashed border-muted-foreground shadow-none">
            <CardContent className="px-4">
              <p className="text-muted-foreground text-sm">No transactions found today, try to add one :&#41;</p>
            </CardContent>
          </Card>
        )}
        {(filteredTransactions?.length ?? 0) > 0 ? (
          <div ref={parent} className="space-y-2">
            {filteredTransactions?.map((tx) => (
              <Card
                key={tx.id}
                onClick={() => setSelectedExpense(tx)}
                className="cursor-pointer hover:shadow-md transition shadow-none"
              >
                <CardContent className="px-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold"> {tx.name.length > 40 ? tx.name.slice(0, 40) + "..." : tx.name}</div>
                      <div className="text-sm text-muted-foreground"> {tx.description.length > 40 ? tx.description.slice(0, 40) + "..." : tx.description}</div>
                      <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(tx.createdAt), { addSuffix: true })}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-end justify-between text-sm">
                    <CategoryBadge category={tx.category} />
                    {/* show original and converted amount */}
                    <div className="text-right">
                      <p className="text-base font-medium">
                        {tx.convertedAmount.toLocaleString(getBestLocale(), {
                          style: "currency",
                          currency: tx.convertedCurrency,
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx.amount.toLocaleString(getBestLocale(), {
                          style: "currency",
                          currency: tx.currency,
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <LatestTransaction />
        )}
      </div>
      {selectedExpense && (
        <ExpenseModal
          expense={selectedExpense}
          onClose={() => setSelectedExpense(null)}
          onSave={async (updated) => {
            await updateMutation.mutateAsync(updated)
            setSelectedExpense(null)
          }}
          onDelete={async (id) => {
            await deleteMutation.mutateAsync(id)
            setSelectedExpense(null)
          }}
        />
      )}
    </div>
  )
}
