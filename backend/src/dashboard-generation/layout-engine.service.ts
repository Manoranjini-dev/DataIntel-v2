// ──────────────────────────────────────────────
// Layout Engine Service — Calculates widget coordinates
// ──────────────────────────────────────────────

import { Injectable } from '@nestjs/common';
import { CreateWidgetDto } from '../dashboard/dashboard-builder.service';

@Injectable()
export class LayoutEngineService {
  private readonly MAX_COLS = 12;

  /**
   * Automatically calculates grid coordinates (x, y, w, h) for a list of widgets
   * using a simple packing algorithm.
   */
  calculateLayout(widgets: Partial<CreateWidgetDto>[]): CreateWidgetDto[] {
    let currentY = 0;
    let currentX = 0;

    return widgets.map((w) => {
      // Determine default dimensions based on chart type
      const { w: width, h: height } = this.getDefaultDimensions(w.widgetType || 'table');

      // If it doesn't fit on current row, move to next row
      if (currentX + width > this.MAX_COLS) {
        currentX = 0;
        currentY += 4; // Assume max row height of 4 for simplicity, or we could track row height
      }

      const widgetWithCoords: CreateWidgetDto = {
        ...(w as any),
        gridX: currentX,
        gridY: currentY,
        gridW: width,
        gridH: height,
        layoutDesktop: { x: currentX, y: currentY, w: width, h: height },
      };

      currentX += width;

      return widgetWithCoords;
    });
  }

  private getDefaultDimensions(chartType: string): { w: number; h: number } {
    switch (chartType) {
      case 'metric_card':
        return { w: 3, h: 2 }; // Small 1/4 row
      case 'line_chart':
      case 'bar_chart':
      case 'area_chart':
      case 'scatter':
        return { w: 6, h: 4 }; // Half row
      case 'pie_chart':
      case 'donut_chart':
      case 'gauge':
        return { w: 4, h: 4 }; // 1/3 row
      case 'table':
      case 'pivot':
        return { w: 12, h: 5 }; // Full row
      default:
        return { w: 6, h: 4 };
    }
  }
}
