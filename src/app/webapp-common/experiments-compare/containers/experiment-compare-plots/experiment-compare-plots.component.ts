import {ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {SelectableListItem} from '@common/shared/ui-components/data/selectable-list/selectable-list.model';
import {Observable, Subscription} from 'rxjs';
import {select, Store} from '@ngrx/store';
import {ExperimentInfoState} from '~/features/experiments/reducers/experiment-info.reducer';
import {distinctUntilChanged, filter, map, tap} from 'rxjs/operators';
import {selectRouterParams} from '@common/core/reducers/router-reducer';
import {convertMultiPlots, prepareMultiPlots, sortMetricsList} from '@common/tasks/tasks.utils';
import {isEqual} from 'lodash-es';
import {
  getMultiPlotCharts,
  resetExperimentMetrics,
  setExperimentMetricsSearchTerm,
  setExperimentSettings,
  setSelectedExperiments
} from '../../actions/experiments-compare-charts.actions';
import {
  selectCompareTasksPlotCharts,
  selectExperimentMetricsSearchTerm,
  selectSelectedExperimentSettings,
  selectSelectedSettingsHiddenPlot
} from '../../reducers';
import {ExtFrame} from '@common/shared/single-graph/plotly-graph-base';
import {RefreshService} from '@common/core/services/refresh.service';
import {addMessage} from '@common/core/actions/layout.actions';
import {ExperimentGraphsComponent} from '@common/shared/experiment-graphs/experiment-graphs.component';
import { ReportCodeEmbedService } from '~/shared/services/report-code-embed.service';
import {ActivatedRoute} from '@angular/router';
import {EntityTypeEnum} from '~/shared/constants/non-common-consts';

@Component({
  selector: 'sm-experiment-compare-plots',
  templateUrl: './experiment-compare-plots.component.html',
  styleUrls: ['./experiment-compare-plots.component.scss']
})
export class ExperimentComparePlotsComponent implements OnInit, OnDestroy {

  private routerParams$: Observable<any>;
  public listOfHidden: Observable<Array<any>>;
  public plots$: Observable<any>;
  public experimentSettings$: Observable<any>;
  public searchTerm$: Observable<string>;

  private plotsSubscription: Subscription;
  private settingsSubscription: Subscription;
  private routerParamsSubscription: Subscription;
  private refreshingSubscription: Subscription;

  public graphList: SelectableListItem[] = [];
  public selectedGraph: string = null;
  private taskIds: Array<string>;
  public graphs: { [key: string]: ExtFrame[] };
  public refreshDisabled: boolean;

  @ViewChild(ExperimentGraphsComponent) graphsComponent: ExperimentGraphsComponent;
  private entityType: EntityTypeEnum;
  public modelsFeature: boolean;

  constructor(
    private store: Store,
    private changeDetection: ChangeDetectorRef,
    private route: ActivatedRoute,
    private refresh: RefreshService,
    private reportEmbed: ReportCodeEmbedService,
  ) {
    this.modelsFeature = this.route.snapshot?.parent.data?.setAllProject;
    this.listOfHidden = this.store.pipe(select(selectSelectedSettingsHiddenPlot));
    this.searchTerm$ = this.store.pipe(select(selectExperimentMetricsSearchTerm));
    this.plots$ = this.store.pipe(
      select(selectCompareTasksPlotCharts),
      filter(metrics => !!metrics),
      distinctUntilChanged()
    );
    this.experimentSettings$ = this.store.pipe(
      select(selectSelectedExperimentSettings),
      filter(settings => !!settings),
      map(settings => settings ? settings.selectedPlot : null),
      filter(selectedPlot => selectedPlot !== undefined),
      distinctUntilChanged()
    );

    this.routerParams$ = this.store.pipe(
      select(selectRouterParams),
      filter(params => !!params.ids),
      distinctUntilChanged(),
      tap(() => this.refreshDisabled = true)
    );

  }

  ngOnInit() {
    this.entityType = this.route.snapshot.parent.parent.data.entityType;
    this.plotsSubscription = this.plots$
      .subscribe((metricsPlots) => {
        this.refreshDisabled = false;
        const {merged, parsingError} = prepareMultiPlots(metricsPlots);
        this.graphList = this.prepareList(merged);
        const newGraphs = convertMultiPlots(merged);
        if (!this.graphs || !isEqual(newGraphs, this.graphs)) {
          this.graphs = newGraphs;
        }
        this.changeDetection.detectChanges();
        parsingError && this.store.dispatch(addMessage('warn', `Couldn't read all plots. Please make sure all plots are properly formatted (NaN & Inf aren't supported).`, [], true));
      });

    this.settingsSubscription = this.experimentSettings$
      .subscribe((selectedPlot) => {
        this.selectedGraph = selectedPlot;
        this.graphsComponent?.scrollToGraph(selectedPlot);
        this.store.dispatch(setExperimentSettings({id: this.taskIds, changes: {selectedPlot: null}}));
      });

    this.routerParamsSubscription = this.routerParams$
      .subscribe((params) => {
        if (!this.taskIds || this.taskIds.join(',') !== params.ids) {
          this.taskIds = params.ids.split(',');
          this.store.dispatch(setSelectedExperiments({selectedExperiments: this.taskIds}));
          this.store.dispatch(getMultiPlotCharts({taskIds: this.taskIds, entity: this.entityType}));
        }
      });

    this.refreshingSubscription = this.refresh.tick
      .pipe(filter(auto => auto !== null))
      .subscribe(autoRefresh =>
        this.store.dispatch(getMultiPlotCharts({taskIds: this.taskIds, entity: this.entityType, autoRefresh}))
      );
  }

  ngOnDestroy() {
    this.plotsSubscription.unsubscribe();
    this.settingsSubscription.unsubscribe();
    this.routerParamsSubscription.unsubscribe();
    this.refreshingSubscription.unsubscribe();
    this.resetMetrics();
  }

  private prepareList(metricsScalar): Array<SelectableListItem> {
    const list = metricsScalar ? Object.keys(metricsScalar) : [];
    const sortedList = sortMetricsList(list);
    return sortedList.map((item) => ({name: item, value: item}));
  }

  metricSelected(id) {
    this.store.dispatch(setExperimentSettings({id: this.taskIds, changes: {selectedPlot: id}}));
  }

  hiddenListChanged(hiddenList) {
    this.store.dispatch(setExperimentSettings({id: this.taskIds, changes: {hiddenMetricsPlot: hiddenList}}));
  }


  searchTermChanged(searchTerm: string) {
    this.store.dispatch(setExperimentMetricsSearchTerm({searchTerm}));
  }

  resetMetrics() {
    this.store.dispatch(resetExperimentMetrics());
  }

  createEmbedCode(event: { metrics?: string[]; variants?: string[]; originalObject?: string; domRect: DOMRect }) {
    const entityType = this.entityType === EntityTypeEnum.model ? 'model' : 'task';
    const idsOriginalFirst = event.originalObject ? [event.originalObject, ...this.taskIds.filter(id => id !== event.originalObject)] : this.taskIds;
    this.reportEmbed.createCode({
      type: 'plot',
      objects: idsOriginalFirst,
      objectType: entityType,
      ...event
    });
  }
}
