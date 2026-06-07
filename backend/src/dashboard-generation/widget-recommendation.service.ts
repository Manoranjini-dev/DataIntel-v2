import { Injectable, Logger } from '@nestjs/common';

export interface WidgetRecommendation {
  widgetType: string;
  title: string;
  queryPrompt: string;
  priority: number;
}

@Injectable()
export class WidgetRecommendationService {
  private readonly logger = new Logger(WidgetRecommendationService.name);

  async recommendWidgets(
    orgId: string,
    intent: string,
    schemaContext: { tables: string[] },
  ): Promise<WidgetRecommendation[]> {
    const tables = schemaContext.tables;
    const recommendations: WidgetRecommendation[] = [];

    if (tables.length > 0) {
      recommendations.push({
        widgetType: 'metric_card',
        title: `Total ${tables[0]} count`,
        queryPrompt: `Count total rows in ${tables[0]}`,
        priority: 1,
      });
    }

    if (tables.length > 1) {
      recommendations.push({
        widgetType: 'bar_chart',
        title: `${tables[0]} by category`,
        queryPrompt: `Show ${tables[0]} grouped by the most common categorical column`,
        priority: 2,
      });
    }

    recommendations.push({
      widgetType: 'data_table',
      title: 'Recent records',
      queryPrompt: `Show the 10 most recent records from ${tables[0] || 'the primary table'}`,
      priority: 3,
    });

    return recommendations;
  }
}
