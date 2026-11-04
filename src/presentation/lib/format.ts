const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const compactNumberFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "暂无数据";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "暂无数据";
  }

  return dateFormatter.format(date).replaceAll("/", ".");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "尚未同步";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "尚未同步";
  }

  return dateTimeFormatter.format(date).replaceAll("/", ".");
}

export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

export function formatCommitFrequency(
  count: number | null | undefined,
  capped = false,
): string | null {
  if (count === null || count === undefined) {
    return null;
  }

  return `90 天 ${capped ? `${count}+` : count} 次`;
}
