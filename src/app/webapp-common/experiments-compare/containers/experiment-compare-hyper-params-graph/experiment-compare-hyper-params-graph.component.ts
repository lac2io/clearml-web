import {ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {combineLatest, Observable, Subscription} from 'rxjs';
import {select, Store} from '@ngrx/store';
import {debounceTime, distinctUntilChanged, filter, map, withLatestFrom} from 'rxjs/operators';
import {selectRouterParams, selectRouterQueryParams} from '@common/core/reducers/router-reducer';
import {has} from 'lodash-es';
import {setExperimentSettings, setSelectedExperiments} from '../../actions/experiments-compare-charts.actions';
import {
  selectMetricValueType,
  selectScalarsGraphHyperParams,
  selectScalarsGraphMetrics,
  selectScalarsGraphShowIdenticalHyperParams,
  selectScalarsGraphTasks,
  selectSelectedSettingsHyperParams,
  selectSelectedSettingsMetric
} from '../../reducers';
import {
  getExperimentsHyperParams,
  setShowIdenticalHyperParams,
  setvalueType
} from '../../actions/experiments-compare-scalars-graph.actions';
import {
  GroupedHyperParams,
  MetricOption,
  VariantOption
} from '../../reducers/experiments-compare-charts.reducer';
import {MatRadioChange} from '@angular/material/radio';
import {selectPlotlyReady} from '@common/core/reducers/view.reducer';
import {ExtFrame} from '@common/shared/single-graph/plotly-graph-base';
import {RefreshService} from '@common/core/services/refresh.service';
import {MetricValueType, SelectedMetric} from '@common/experiments-compare/experiments-compare.constants';
import {ReportCodeEmbedService} from '~/shared/services/report-code-embed.service';
import {ActivatedRoute, Router} from '@angular/router';


export const _filter = (opt: VariantOption[], value: string): VariantOption[] => {
  const filterValue = value.toLowerCase();

  return opt.filter(item => item.name.toLowerCase().includes(filterValue));
};

@Component({
  selector: 'sm-experiment-compare-hyper-params-graph',
  templateUrl: './experiment-compare-hyper-params-graph.component.html',
  styleUrls: ['./experiment-compare-hyper-params-graph.component.scss']
})
export class ExperimentCompareHyperParamsGraphComponent implements OnInit, OnDestroy {
  private subs = new Subscription();

  public selectShowIdenticalHyperParams$: Observable<boolean>;
  public hyperParams$: Observable<GroupedHyperParams>;
  public metrics$: Observable<MetricOption[]>;
  public selectedHyperParams$: Observable<string[]>;
  private selectedMetric$: Observable<SelectedMetric>;
  public experiments$: Observable<any[]>;

  public graphs: { [key: string]: ExtFrame };
  public selectedHyperParams: string[];
  public selectedMetric: SelectedMetric;
  public hyperParams: { [section: string]: any };
  public showIdenticalParamsActive: boolean;
  public plotlyReady$ = this.store.select(selectPlotlyReady);

  public metrics: MetricOption[];
  public metricsOptions: MetricOption[];
  public listOpen = true;
  private initView = true;
  private taskIds: string[];

  public metricValueType$: Observable<MetricValueType>;

  public selectedItemsListMapper(data) {
    return data;
  }

  @ViewChild('searchMetric') searchMetricRef: ElementRef;

  @HostListener('document:click', [])
  clickOut() {
    if (!this.initView) {
      this.listOpen = false;
    }
  }

  constructor(private store: Store,
              private route: ActivatedRoute,
              private router: Router,
              private refresh: RefreshService,
              private reportEmbed: ReportCodeEmbedService,
              private cdr: ChangeDetectorRef) {
    this.metrics$ = this.store.pipe(select(selectScalarsGraphMetrics));
    this.hyperParams$ = this.store.pipe(select(selectScalarsGraphHyperParams));
    this.selectedHyperParams$ = this.store.pipe(select(selectSelectedSettingsHyperParams));
    this.selectedMetric$ = this.store.pipe(select(selectSelectedSettingsMetric));
    this.selectShowIdenticalHyperParams$ = this.store.pipe(select(selectScalarsGraphShowIdenticalHyperParams));
    this.experiments$ = this.store.pipe(select(selectScalarsGraphTasks));
    this.metricValueType$ = this.store.pipe(select(selectMetricValueType));

  }

  ngOnInit() {
    this.subs.add(this.selectedMetric$.pipe(
      distinctUntilChanged((x, y) => x?.path === y?.path)
    ).subscribe((selectedMetric: SelectedMetric) => {
      this.selectedMetric = selectedMetric?.path ? {...selectedMetric} : null;
      this.cdr.detectChanges();
    }));

    this.subs.add(this.metrics$.pipe(
      filter(metrics => !!metrics)
    ).subscribe((metrics) => {
      this.metrics = metrics;
      this.metricsOptions = [...metrics];
    }));

    this.subs.add(combineLatest([this.selectedHyperParams$, this.hyperParams$, this.selectShowIdenticalHyperParams$])
      .pipe(
        filter(([, allParams]) => !!allParams),
      )
      .subscribe(([selectedParams, allParams, showIdentical]) => {
        this.showIdenticalParamsActive = showIdentical;
        this.hyperParams = Object.entries(allParams)
          .reduce((acc, [sectionKey, params]) => {
            const section = Object.keys(params)
              .sort((a, b) => a.toLowerCase() > b.toLowerCase() ? 1 : -1)
              .reduce((acc2, paramKey) => {
                if (showIdentical || params[paramKey]) {
                  acc2[paramKey] = true;
                }
                return acc2;
              }, {});
            if (Object.keys(section).length > 0) {
              acc[sectionKey] = section;
            }
            return acc;
          }, {});
        this.selectedHyperParams = selectedParams?.filter(selectedParam => has(this.hyperParams, selectedParam));
        this.cdr.detectChanges();
      }));

    this.subs.add(combineLatest([this.metrics$, this.hyperParams$]).pipe(
      debounceTime(0),
      filter(([metircs, hyperparams]) => metircs?.length > 0 && Object.keys(hyperparams || {})?.length > 0),
      withLatestFrom(this.store.select(selectRouterQueryParams))
    ).subscribe(([[metircs], queryParams]) => {
      if (queryParams.metricPath) {
        const selectedMetric = metircs.map(a => a.variants).flat(2).find(variant => variant.value.path === queryParams.metricPath)?.value ?? null;
        const params = Array.isArray(queryParams.params) ? queryParams.params : [queryParams.params];
        this.updateServer(selectedMetric, params, true);
        this.listOpen = false;
        this.cdr.detectChanges();
      }
    }));

    this.subs.add(this.store.pipe(
      select(selectRouterParams),
      map(params => params?.ids),
      distinctUntilChanged(),
      filter(ids => !!ids),
    )
      .subscribe((ids) => {
        this.taskIds = ids.split(',');
        this.store.dispatch(setSelectedExperiments({selectedExperiments: ['hyper-param-graph']}));
        this.store.dispatch(getExperimentsHyperParams({experimentsIds: this.taskIds}));
      }));

    this.subs.add(this.refresh.tick
      .pipe(filter(auto => auto !== null))
      .subscribe(autoRefresh =>
        this.store.dispatch(getExperimentsHyperParams({experimentsIds: this.taskIds, autoRefresh}))
      ));

    this.listOpen = true;
    window.setTimeout(() => {
      this.searchMetricRef.nativeElement.focus();
      this.initView = false;
      this.cdr.detectChanges();
    }, 200);
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  private _filterGroup(value: string): MetricOption[] {
    if (value) {
      return this.metrics
        .map(group => ({metricName: group.metricName, variants: _filter(group.variants, value)}))
        .filter(group => group.variants.length > 0);
    }

    return this.metrics;
  }

  metricSelected(metric: VariantOption) {
    this.updateServer(metric.value, this.selectedHyperParams);
    this.listOpen = false;
  }

  selectedParamsChanged({param}) {
    const newSelectedParamsList = this.selectedHyperParams.includes(param) ? this.selectedHyperParams.filter(i => i !== param) : [...this.selectedHyperParams, param];
    this.updateServer(this.selectedMetric, newSelectedParamsList);
  }

  clearSelection() {
    this.updateServer(this.selectedMetric, []);
  }

  showIdenticalParamsToggled() {
    this.store.dispatch(setShowIdenticalHyperParams());
  }

  updateServer(selectedMetric: SelectedMetric, selectedParams: string[], skipNavigation?: boolean) {
    !skipNavigation && this.router.navigate([], {
      queryParams: {
        metricPath: selectedMetric?.path || undefined,
        metricName: selectedMetric?.name || undefined,
        params: selectedParams
      },
      queryParamsHandling: 'merge'
    });
    this.store.dispatch(setExperimentSettings({
      id: ['hyper-param-graph'],
      changes: {selectedMetric, selectedHyperParams: selectedParams}
    }));
  }

  updateMetricsList(event: Event) {
    this.metricsOptions = this._filterGroup((event.target as HTMLInputElement).value);
  }

  clearMetricSearchAndSelected() {
    this.updateServer(null, this.selectedHyperParams);
    this.selectedMetric = null;
    this.metricsOptions = this._filterGroup('');
  }

  clearMetricSearch() {
    this.metricsOptions = this._filterGroup('');
  }

  openList() {
    this.listOpen = true;
  }

  trackMetricByFn(index: number, item: MetricOption): string {
    return item.metricName;
  }

  trackVariantByFn(index: number, item: VariantOption): string {
    // TODO: validate with @nirla
    return item.value.path;
  }

  valueTypeChange($event: MatRadioChange) {
    this.store.dispatch(setvalueType({valueType: $event.value}));
  }

  createEmbedCode(event: { tasks: string[]; valueType: MetricValueType; metrics?: string[]; variants?: string[]; domRect: DOMRect }) {
    this.reportEmbed.createCode({
      type: 'parcoords',
      objects: event.tasks,
      objectType: 'task',
      ...event
    });
  }
}
