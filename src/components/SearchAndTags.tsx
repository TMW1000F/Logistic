import { useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';

export interface FilterTag {
  field: string; // 'car_number' | 'car_type' | 'carrier' | 'date' | 'service_type'
  value: string;
  label: string;
}

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  tags: FilterTag[];
  onRemoveTag: (index: number) => void;
  onClearAll: () => void;
  placeholder?: string;
}

export default function SearchAndTags({ searchQuery, onSearchChange, tags, onRemoveTag, onClearAll, placeholder }: Props) {
  return (
    <div className="space-y-2">
      {/* Строка поиска */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={placeholder || '🔍 Поиск по всем полям...'}
          className="w-full border rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Теги фильтров */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Фильтры:</span>
          {tags.map((tag, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full"
            >
              <span className="font-medium">{tag.label}:</span>
              <span>{tag.value}</span>
              <button
                onClick={() => onRemoveTag(idx)}
                className="ml-1 hover:text-red-600"
                title="Удалить фильтр"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-red-600 underline"
          >
            Сбросить все
          </button>
        </div>
      )}
    </div>
  );
}
