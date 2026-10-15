import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Action } from './components';
import { AnimatedNumber } from './motion';
import { Icon } from './icons';
import { AttendanceChart, ChartDetail, DailyChart } from './charts';

const number = value => Number(value || 0).toLocaleString('pt-BR');
const dateLabel = date => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function Metric({ label, value, detail, accent, icon, onClick, permission }) {
  const content = <><div className="analytics-metric-heading"><span>{label}</span><span className="analytics-metric-icon"><Icon name={icon} size={18}/></span></div><strong><AnimatedNumber value={value}/></strong><small>{detail}{onClick && <Icon name="arrowUpRight" size={14}/>}</small></>;
  return onClick ? <Action className={`analytics-metric ${accent || ''}`} action={onClick} permission={permission}>{content}</Action> : <article className={`analytics-metric ${accent || ''}`}>{content}</article>;
}

export function Dashboard({ ctx }) {
  const [days, setDays] = useState(7), [chipId, setChipId] = useState(''), [type, setType] = useState('area');
  const [stats, setStats] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [channels, setChannels] = useState([]);
  const [revision, setRevision] = useState(0), [table, setTable] = useState(false);
  const query = new URLSearchParams({ days: String(days), ...(chipId ? { chipId } : {}) }).toString();
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api(`/api/dashboard/stats?${query}`);
        if (active) { setStats(result); setChannels(result.channels || []); setError(''); }
      } catch (failure) { if (active) setError(failure.message); }
      finally { pending = false; if (active) setLoading(false); }
    };
    setLoading(true); setStats(null); setError(''); refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [query, revision]);
  const inbox = filter => {
    if (chipId) ctx.selectChannel(chipId);
    ctx.setFilter(filter); ctx.navigate('inbox');
  };
  const daily = stats?.daily || [], total = (stats?.received || 0) + (stats?.sent || 0);
  const counts = [{ name: 'Abertas', value: stats?.open || 0, color: 'var(--analytics-green)' }, { name: 'Finalizadas', value: stats?.finalized || 0, color: 'var(--analytics-purple)' }, { name: 'Bloqueadas', value: stats?.blocked || 0, color: 'var(--text-faint)' }];
  const conversations = counts.reduce((sum, row) => sum + row.value, 0);
  const hourMax = Math.max(1, ...(stats?.hourly || []).map(row => row.received + row.sent));
  const peak = stats?.hourly?.reduce((best, row) => row.received + row.sent > best.received + best.sent ? row : best, { hour: 0, received: 0, sent: 0 });
  const opportunities = ctx.data.kanban?.opportunities || [];
  const sales = [{ name: 'Em andamento', value: opportunities.filter(row => row.status !== 'won' && row.status !== 'lost').length, color: 'var(--analytics-purple)' }, { name: 'Ganhas', value: opportunities.filter(row => row.status === 'won').length, color: 'var(--analytics-green)' }, { name: 'Perdidas', value: opportunities.filter(row => row.status === 'lost').length, color: 'var(--analytics-peach)' }];
  return <div className="analytics-dashboard" aria-busy={loading}>
    <header className="analytics-header">
      <div><p className="eyebrow">Visão do negócio</p><h2>Dashboard</h2><p>Atendimento e resultados, em um só lugar.</p></div>
      <div className="analytics-header-actions">
        <Action className="text-action" permission="relatorios.exportar" disabled={loading || !stats} action={async () => {
          const response = await fetch(`/api/dashboard/export?${query}`, { credentials: 'same-origin' });
          if (!response.ok) throw new Error((await response.json()).error || 'Não foi possível exportar.');
          const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'relatorio-bot-wap.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}><Icon name="download" size={15}/>Exportar relatório</Action>
        <Action className="text-action text-action--primary" permission="atendimento.visualizar" action={() => inbox('all')}>Abrir atendimento<Icon name="arrowUpRight" size={15}/></Action>
      </div>
    </header>
    <div className="analytics-toolbar">
      <div className="analytics-filters"><div className="analytics-segment" role="group" aria-label="Período da dashboard">{[7, 14, 30].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value} dias</button>)}</div>
        <label className="analytics-chip-filter"><span>Chip</span><select aria-label="Filtrar dashboard por chip" value={chipId} onChange={event => setChipId(event.target.value)}><option value="">Todos os chips</option>{channels.map(chip => <option value={chip.id} key={chip.id}>{chip.name}</option>)}</select></label>
      </div>
      <div className="analytics-updated"><span className="analytics-live-dot"/>{loading ? 'Atualizando…' : stats ? `Atualizado ${new Date(stats.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : 'Dados indisponíveis'}<button type="button" className="text-action analytics-refresh" aria-label="Atualizar dashboard" disabled={loading} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={15}/></button></div>
    </div>
    {error && <div className="analytics-error" role="alert">{error}<button type="button" className="text-action" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div>}
    {loading && !stats ? <div className="analytics-loading" role="status"><div className="analytics-skeleton" aria-hidden="true">{[0, 1, 2, 3].map(index => <div key={index}><i/><i/><i/></div>)}</div><span>Carregando indicadores e gráficos…</span></div> : stats && <>
      <div className="analytics-metrics">
        <Metric label="Conversas abertas" value={stats.open} icon="conversation" detail="Situação atual" accent="green" onClick={ctx.can('atendimento.visualizar') ? () => inbox('all') : undefined} permission="atendimento.visualizar"/>
        <Metric label="Aguardando resposta" value={stats.awaitingReply} icon="clock" detail="Última mensagem do cliente" accent="peach"/>
        <Metric label="Mensagens no período" value={total} icon="activity" detail={`${number(stats.received)} recebidas · ${number(stats.sent)} enviadas`} accent="purple"/>
        <Metric label="Finalizadas" value={stats.finalized} icon="doubleCheck" detail="Situação atual" onClick={ctx.can('atendimento.visualizar') ? () => inbox('finalized') : undefined} permission="atendimento.visualizar"/>
      </div>
      <div className="analytics-main-grid">
        <section className="analytics-panel analytics-movement"><div className="analytics-panel-heading"><div><p className="eyebrow">Volume de mensagens</p><h3>Movimentação diária</h3></div><div className="analytics-segment analytics-chart-switch" role="group" aria-label="Tipo de gráfico">{[['area', 'Área'], ['lines', 'Linhas'], ['bars', 'Barras']].map(([value, label]) => <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(value)}>{label}</button>)}</div></div>
          <div className="analytics-chart-legend"><span><i className="received"/>Recebidas <strong><AnimatedNumber value={stats.received}/></strong></span><span><i className="sent"/>Enviadas <strong><AnimatedNumber value={stats.sent}/></strong></span></div>
          <div id="activityChart">{total ? <DailyChart rows={daily} type={type}/> : <div className="analytics-empty"><strong>Sem mensagens neste período</strong><p>Selecione outro período ou chip para consultar o histórico.</p></div>}</div>
          <div className="analytics-chart-footer"><span>Últimos {days} dias · horário de Brasília</span><button type="button" className="text-action" aria-expanded={table} onClick={() => setTable(value => !value)}>{table ? 'Ocultar dados' : 'Ver dados por dia'}</button></div>
          {table && <div className="analytics-data-table"><table><caption>Mensagens nos últimos {days} dias</caption><thead><tr><th>Data</th><th>Recebidas</th><th>Enviadas</th><th>Total</th></tr></thead><tbody>{daily.map(row => <tr key={row.date}><td>{dateLabel(row.date)}</td><td>{number(row.received)}</td><td>{number(row.sent)}</td><td>{number(row.received + row.sent)}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="analytics-panel"><div className="analytics-panel-heading"><div><p className="eyebrow">Situação atual</p><h3>Atendimentos</h3></div><span className="analytics-badge">{number(conversations)} conversas</span></div>
          <AttendanceChart counts={counts}/>
        </section>
      </div>
      <div className="analytics-bottom-grid">
        <section className="analytics-panel"><div className="analytics-panel-heading"><div><p className="eyebrow">Distribuição por horário</p><h3>Quando chegam as mensagens?</h3></div></div><p className="analytics-panel-description">Recebidas e enviadas nos últimos {days} dias.</p>
          <div className="analytics-hours" role="group" aria-label="Mensagens por hora">{stats.hourly.map(row => { const count = row.received + row.sent; const label = `${String(row.hour).padStart(2, '0')}h: ${count} mensagens, ${row.received} recebidas e ${row.sent} enviadas`; return <ChartDetail key={row.hour} title={`${String(row.hour).padStart(2, '0')}h — ${String(row.hour).padStart(2, '0')}h59`} items={[{ label: 'Recebidas', value: number(row.received), color: 'var(--analytics-green)' }, { label: 'Enviadas', value: number(row.sent), color: 'var(--analytics-purple)' }, { label: 'Total', value: `${number(count)} mensagens` }, { label: 'Participação no período', value: `${total ? Math.round(count / total * 100) : 0}%` }]} footer={`Acumulado dos últimos ${days} dias · horário de Brasília.`}><div className="analytics-hour" tabIndex="0" aria-label={label}><span style={{ '--intensity': count ? .15 + count / hourMax * .85 : 0 }}/><small>{String(row.hour).padStart(2, '0')}</small></div></ChartDetail>; })}</div>
          <p className="analytics-insight">{total ? <>Maior movimento às <strong>{String(peak.hour).padStart(2, '0')}h</strong>, com {number(peak.received + peak.sent)} mensagens.</> : 'O mapa será preenchido quando houver mensagens.'}</p>
        </section>
        <section className="analytics-panel"><div className="analytics-panel-heading"><div><p className="eyebrow">Comparativo dos canais</p><h3>Mensagens por chip</h3></div><span className="analytics-badge">{days} dias</span></div><div className="analytics-ranking">{channels.length ? [...channels].sort((a, b) => b.messages - a.messages).map(chip => <ChartDetail key={chip.id} title={chip.name} items={[{ label: 'Mensagens', value: number(chip.messages) }, { label: 'Conexão', value: chip.connected ? 'Conectado' : 'Desconectado' }, { label: 'Participação entre os canais', value: `${Math.round(chip.messages / Math.max(1, channels.reduce((sum, row) => sum + row.messages, 0)) * 100)}%` }]} footer={`Últimos ${days} dias. Clique para filtrar este chip.`}><button type="button" onClick={() => setChipId(String(chip.id))} aria-label={`Filtrar por ${chip.name}, ${chip.messages} mensagens`}><span><i className={`analytics-channel-dot ${chip.connected ? 'online' : ''}`}/>{chip.name}<strong><AnimatedNumber value={chip.messages}/></strong></span><span className="analytics-track"><i style={{ width: `${chip.messages / Math.max(1, ...channels.map(row => row.messages)) * 100}%` }}/></span></button></ChartDetail>) : <p className="analytics-panel-description">Cadastre um chip para acompanhar os canais.</p>}</div></section>
        {ctx.can('funis.visualizar') && <section className="analytics-panel"><div className="analytics-panel-heading"><div><p className="eyebrow">Todos os funis acessíveis</p><h3>Resultados comerciais</h3></div><Action className="text-action" permission="funis.visualizar" action={() => ctx.navigate('kanban')}>Ver funis ↗</Action></div><div className="analytics-sales"><div><span>Receita ganha</span><strong><AnimatedNumber value={stats.revenue} format="money"/></strong></div><div><span>Conversão</span><strong><AnimatedNumber value={stats.conversionRate} format="percent"/></strong></div></div><div className="analytics-sales-bars">{sales.map(row => <ChartDetail key={row.name} title={row.name} items={[{ label: 'Oportunidades', value: number(row.value), color: row.color }, { label: 'Participação', value: `${Math.round(row.value / Math.max(1, opportunities.length) * 100)}%` }]} footer="Situação atual dos funis acessíveis; independente do período e chip."><div tabIndex="0" aria-label={`${row.name}: ${number(row.value)} oportunidades`}><span>{row.name}<strong>{number(row.value)}</strong></span><span className="analytics-track"><i style={{ background: row.color, width: `${row.value / Math.max(1, opportunities.length) * 100}%` }}/></span></div></ChartDetail>)}</div><p className="analytics-panel-description">Situação atual dos funis; independente do período e chip selecionados.</p></section>}
      </div>
    </>}
  </div>;
}
