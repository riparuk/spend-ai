import { prisma } from "./prisma"
import { Redis } from "@upstash/redis"
import { getTodayKey } from "./utils"
import { Prisma } from "@prisma/client";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export type UpdateUserInput = {
  currency?: string;
  aiExpensePrompt?: string;
  aiInsightPrompt?: string;
}

// Utility function to fetch and cache exchange rates
export async function getCachedExchangeRates(): Promise<Record<string, number>> {
  const key = getTodayKey();
  let data = await redis.get<{ rates: Record<string, number> }>(key);

  if (!data) {
    console.log("Fetching exchange rate from API");
    const response = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    data = await response.json();
    await redis.set(key, data, { ex: 86400 });
  }

  return data?.rates || {};
}

export async function getConversionRateFromUSD(toCurrency: string) {
  const key = getTodayKey();
  let data = await redis.get<{ rates: Record<string, number> }>(key);

  if (!data) {
    console.log("Fetching exchange rate from API")
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    data = await response.json();
    await redis.set(key, data, { ex: 86400 }); // TTL 1 day
  }

  const rate = data?.rates?.[toCurrency];

  if (typeof rate !== 'number') {
    throw new Error(`Conversion rate for ${toCurrency} not found`);
  }

  return rate;
}

export async function getUser(userId: string) {
  return await prisma.user.findUnique({ where: { id: userId } })
}

export async function updateUser(userId: string, data: UpdateUserInput) {
  return await prisma.user.update({
    where: { id: userId },
    data,
  })
}

export async function getLatestTransactions(
  userId: string,
  targetCurrency: string = "USD",
  limit: number = 3,
) {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });

  const rates = await getCachedExchangeRates();
  const targetRate = rates[targetCurrency];
  if (!targetRate || targetRate === 0) {
    throw new Error(`Rate for target currency ${targetCurrency} not found`);
  }

  return transactions.map(tx => ({
    ...tx,
    convertedAmount: tx.currency === targetCurrency
      ? tx.amount
      : tx.amount * targetRate / rates[tx.currency],
    convertedCurrency: targetCurrency,
  }));
}

export async function getTransactions(
  userId: string,
  targetCurrency: string = "USD",
  filter?: {
    category?: string;
    currency?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
    skip?: number;
    take?: number;
  },
) {
  // Reusable `where` condition
  const where = {
    userId,
    ...(filter?.category && { category: filter.category }),
    ...(filter?.currency && { currency: filter.currency }),
    ...(filter?.search && {
      OR: [
        { name: { contains: filter.search, mode: "insensitive" } },
        { description: { contains: filter.search, mode: "insensitive" } },
      ],
    }),
    ...(filter?.startDate || filter?.endDate
      ? {
        createdAt: {
          ...(filter?.startDate && { gte: filter.startDate }),
          ...(filter?.endDate && { lte: filter.endDate }),
        },
      }
      : {}),
  };

  // Count total matching transactions (for pagination)
  const total = await prisma.transaction.count({ where });
  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: filter?.skip,
    take: filter?.take,
  });

  // Get exchange rates
  const rates = await getCachedExchangeRates();
  const targetRate = rates[targetCurrency];

  if (!targetRate || targetRate === 0) {
    throw new Error(`Rate for target currency ${targetCurrency} not found`);
  }

  const data = transactions.map((tx) => {
    const fromRate = rates[tx.currency] ?? 1;
    const convertedAmount =
      tx.currency === targetCurrency
        ? tx.amount
        : (tx.amount * targetRate) / fromRate;

    return {
      ...tx,
      convertedAmount,
      convertedCurrency: targetCurrency,
    };
  });

  return { data, total };
}

export async function createTransaction(transaction: Prisma.TransactionCreateInput) {
  return await prisma.transaction.create({ data: transaction })
}

export async function isTransactionOwnedByUser(transactionId: string, userId: string): Promise<boolean> {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { userId: true }
  })

  return tx?.userId === userId
}

export async function deleteTransaction(userId: string, transactionId: string) {
  const owned = await isTransactionOwnedByUser(transactionId, userId)
  if (!owned) {
    throw new Error("Unauthorized or transaction not found")
  }

  return await prisma.transaction.delete({
    where: { id: transactionId }
  })
}

export async function updateTransaction(userId: string, data: {
  id: string,
  name: string,
  description: string,
  category: string,
  amount: number,
  currency: string,
}) {
  return await prisma.transaction.update({
    where: {
      id: data.id,
      userId: userId,
    },
    data: {
      name: data.name,
      description: data.description,
      category: data.category,
      amount: data.amount,
      currency: data.currency,
    },
  })
}


export async function getCategoryBreakdown(
  userId: string,
  targetCurrency: string = "USD",
  startDate?: Date,
  endDate?: Date
) {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
        : {}),
    },
    select: {
      amount: true,
      category: true,
      currency: true,
    },
  });

  const rates = await getCachedExchangeRates();
  const targetRate = rates[targetCurrency];
  if (!targetRate || targetRate === 0) {
    throw new Error(`Rate for target currency ${targetCurrency} not found`);
  }

  const totalsByCategory: Record<string, number> = {};

  for (const tx of transactions) {
    const fromRate = rates[tx.currency] ?? 1;
    const convertedAmount = tx.currency === targetCurrency
      ? tx.amount
      : tx.amount * targetRate / fromRate;

    totalsByCategory[tx.category] = (totalsByCategory[tx.category] || 0) + convertedAmount;
  }

  const total = Object.values(totalsByCategory).reduce((sum, val) => sum + val, 0);

  const breakdown = Object.entries(totalsByCategory)
    .map(([category, amount]) => ({
      category,
      amount,
      currency: targetCurrency,
      percentage: total > 0 ? Math.round((amount / total) * 100) : 0 // rounded to 2 decimal places
    }))
    .sort((a, b) => b.amount - a.amount);

  return breakdown;
}

export async function getSpendingTrends(
  userId: string,
  period: "daily" | "weekly" | "monthly" = "daily",
  targetCurrency: string = "USD",
  historyCount: number = 7
) {
  const now = new Date();
  const startDate = new Date();

  if (period === "daily") {
    startDate.setDate(now.getDate() - historyCount + 1);
  } else if (period === "weekly") {
    startDate.setDate(now.getDate() - 7 * (historyCount - 1));
  } else {
    startDate.setMonth(now.getMonth() - historyCount + 1);
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      createdAt: {
        gte: startDate,
        lte: now,
      },
    },
    select: {
      amount: true,
      currency: true,
      createdAt: true,
    },
  });

  const rates = await getCachedExchangeRates();
  const targetRate = rates[targetCurrency];
  if (!targetRate || targetRate === 0) {
    throw new Error(`Rate for target currency ${targetCurrency} not found`);
  }

  const totalsByPeriod: Record<string, number> = {};

  for (const tx of transactions) {
    const fromRate = rates[tx.currency] ?? 1;
    const convertedAmount = tx.currency === targetCurrency
      ? tx.amount
      : tx.amount * targetRate / fromRate;

    let key: string;
    const date = new Date(tx.createdAt);
    if (period === "daily") {
      key = date.toISOString().slice(0, 10); // YYYY-MM-DD
    } else if (period === "weekly") {
      const start = new Date(date);
      start.setDate(date.getDate() - date.getDay());
      key = start.toISOString().slice(0, 10);
    } else {
      key = date.toISOString().slice(0, 7); // YYYY-MM
    }

    totalsByPeriod[key] = (totalsByPeriod[key] || 0) + convertedAmount;
  }

  const sorted = Object.entries(totalsByPeriod)
    .map(([key, total]) => ({ period: key, total, currency: targetCurrency }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return sorted;
}


export async function getCategorySpendingComparison(
  userId: string,
  targetCurrency: string = "USD",
  historyCount: number = 3,
  period: "daily" | "weekly" | "monthly" = "monthly"
) {
  const now = new Date();
  let startOfCurrent: Date;
  let startOfHistory: Date;

  if (period === "daily") {
    startOfCurrent = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    startOfHistory = new Date(startOfCurrent);
    startOfHistory.setDate(startOfCurrent.getDate() - historyCount);
  } else if (period === "weekly") {
    const dayOfWeek = now.getDay();
    startOfCurrent = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    startOfHistory = new Date(startOfCurrent);
    startOfHistory.setDate(startOfCurrent.getDate() - 7 * historyCount);
  } else {
    startOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfHistory = new Date(startOfCurrent.getFullYear(), startOfCurrent.getMonth() - historyCount, 1);
  }

  const current = await getCategoryBreakdown(userId, targetCurrency, startOfCurrent, now);
  const history = await getCategoryBreakdown(userId, targetCurrency, startOfHistory, startOfCurrent);

  const averageMap: Record<string, number> = {};
  for (const item of history) {
    averageMap[item.category] = item.amount / historyCount;
  }

  const result = current.map((item) => {
    const avg = averageMap[item.category] ?? 0;
    const percentDiff = avg === 0 ? 100 : ((item.amount - avg) / avg) * 100;

    return {
      category: item.category,
      current: Math.round(item.amount),
      average: Math.round(avg),
      percentage: Math.round(percentDiff),
      currency: targetCurrency,
    };
  });

  return result;
}

export async function getTopExpenses(
  userId: string,
  filter?: {
    limit?: number;
    category?: string;
    startDate?: Date;
    endDate?: Date;
    currency?: string;
  }
) {
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      ...(filter?.category && { category: filter.category }),
      ...(filter?.startDate || filter?.endDate
        ? {
          createdAt: {
            ...(filter?.startDate && { gte: filter.startDate }),
            ...(filter?.endDate && { lte: filter.endDate }),
          },
        }
        : {}),
    },
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      createdAt: true,
      category: true,
    },
  });

  const targetCurrency = filter?.currency ?? "USD";

  const currencies = [...new Set(transactions.map(tx => tx.currency))];

  const baseRates = await getCachedExchangeRates();

  for (const currency of currencies) {
    const rate = baseRates?.[currency];
    if (!rate || rate === 0) {
      throw new Error(`Rate for ${currency} not found or invalid`);
    }
  }

  const targetRate = baseRates[targetCurrency];
  if (!targetRate || targetRate === 0) {
    throw new Error(`Rate for target currency ${targetCurrency} not found`);
  }

  const converted = transactions.map((tx) => {
    const fromRate = baseRates[tx.currency] ?? 1;
    const convertedAmount = tx.currency === targetCurrency
      ? tx.amount
      : tx.amount * targetRate / fromRate;

    return {
      ...tx,
      convertedAmount,
      convertedCurrency: targetCurrency,
    };
  });

  const sorted = converted.sort((a, b) => b.convertedAmount - a.convertedAmount);

  return sorted.slice(0, filter?.limit ?? 5);
}
