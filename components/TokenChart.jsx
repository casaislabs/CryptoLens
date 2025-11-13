import React from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip } from 'recharts';
import { Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function TokenChart({ chartData = [], token, loading = false, chartError = false }) {
  return (
    <div className="bg-neutral-900 p-4 rounded-lg shadow-md border border-neutral-700">
      {loading ? (
        <div className="flex items-center justify-center h-[300px] text-gray-400">
          <p>Loading chart data...</p>
        </div>
      ) : chartError ? (
        <div className="flex items-center justify-center h-[300px] text-red-400">
          <p>Error loading chart data. Please try again.</p>
        </div>
      ) : chartData && chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart key={`chart-${token?.id}-${chartData.length}`} data={chartData}>
            <XAxis dataKey="date" hide />
            <YAxis dataKey="price" domain={["auto", "auto"]} hide />
            <RechartsTooltip
              content={({ payload }) => {
                if (payload && payload.length) {
                  return (
                    <ShadTooltip>
                      <TooltipTrigger>
                        <div className="p-2 bg-neutral-800 text-white rounded-md shadow-lg">
                          <p className="text-sm">
                            <strong>Date:</strong> {payload[0].payload.date}
                          </p>
                          <p className="text-sm">
                            <strong>Price:</strong> ${payload[0].payload.price.toFixed(2)}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Price data for the selected date.</p>
                      </TooltipContent>
                    </ShadTooltip>
                  );
                }
                return null;
              }}
            />
            <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-[300px] text-gray-400">
          <p>No chart data available</p>
        </div>
      )}
    </div>
  );
}