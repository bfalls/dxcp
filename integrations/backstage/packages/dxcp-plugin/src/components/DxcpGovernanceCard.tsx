import { InfoCard, Progress, WarningPanel } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Link,
  Typography,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

import { useDxcpDeliveryStatus } from '../api/useDxcpDeliveryStatus';

const useStyles = makeStyles(theme => ({
  root: {
    paddingTop: theme.spacing(1),
  },
  sectionTitle: {
    fontWeight: 700,
    letterSpacing: 0.2,
  },
  section: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(2),
    background: theme.palette.background.paper,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(2),
  },
  serviceId: {
    fontWeight: 600,
    opacity: 0.9,
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    padding: `${theme.spacing(0.75)}px 0`,
  },
  label: {
    color: theme.palette.text.secondary,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    whiteSpace: 'nowrap',
  },
  value: {
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtle: {
    color: theme.palette.text.secondary,
    fontSize: 12,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: theme.spacing(2),
  },
}));

function fmt(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusChipLabel(state?: string, outcome?: string) {
  const raw = (state ?? outcome ?? 'UNKNOWN').toString().toUpperCase();
  return raw;
}

function statusChipColor(state?: string, outcome?: string): 'default' | 'primary' | 'secondary' {
  const raw = (state ?? outcome ?? '').toString().toUpperCase();
  if (raw === 'SUCCEEDED' || raw === 'SUCCESS') return 'primary';
  if (raw === 'FAILED' || raw === 'FAILURE') return 'secondary';
  return 'default';
}

function LabeledRow(props: { label: string; value?: string | number | null }) {
  const { label, value } = props;
  return (
    <Box display="flex" className={(useStyles as any)().row}>
      <Typography className={(useStyles as any)().label}>{label}</Typography>
      <Typography className={(useStyles as any)().value}>
        {value === undefined || value === null || value === '' ? '—' : value}
      </Typography>
    </Box>
  );
}

export const DxcpGovernanceCard = () => {
  const classes = useStyles();
  const { entity } = useEntity();

  const serviceId =
    entity.metadata.annotations?.['dxcp.io/service-id'] ?? entity.metadata.name;

  // ✅ keep your existing hook call; if your hook needs serviceId instead, pass serviceId
  const { loading, error, value } = useDxcpDeliveryStatus(serviceId);
  const data = value;

  const rawUrl = `/api/dxcp/services/${encodeURIComponent(serviceId)}/delivery-status`;

  return (
    <InfoCard title="Delivery Governance (DXCP) v777">
      <Box className={classes.root}>
        <Box className={classes.headerRow}>
          <Box>
            <Typography variant="subtitle1" className={classes.serviceId}>
              {serviceId}
            </Typography>
            <Typography className={classes.subtle}>
              Delivery authority & current state (read-only)
            </Typography>
          </Box>

          <Box>
            <Chip
              size="small"
              label={
                data?.latest
                  ? statusChipLabel(data.latest.state, data.latest.outcome ?? undefined)
                  : '—'
              }
              color={
                data?.latest
                  ? statusChipColor(data.latest.state, data.latest.outcome ?? undefined)
                  : 'default'
              }
            />
          </Box>
        </Box>

        {loading && <Progress />}

        {error && (
          <WarningPanel title="Unable to retrieve delivery status">
            {String(error)}
          </WarningPanel>
        )}

        {!loading && !error && !data && (
          <Typography className={classes.subtle}>
            No DXCP data available for this component.
          </Typography>
        )}

        {!loading && !error && data && (
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Box className={classes.section}>
                <Typography variant="subtitle2" className={classes.sectionTitle}>
                  Current Running
                </Typography>
                <Divider style={{ margin: '12px 0' }} />

                <LabeledRow label="Version" value={data.currentRunning?.version ?? '—'} />
                <LabeledRow label="Environment" value={data.currentRunning?.environment ?? '—'} />
                <LabeledRow label="Derived At" value={fmt(data.currentRunning?.derivedAt)} />
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <Box className={classes.section}>
                <Typography variant="subtitle2" className={classes.sectionTitle}>
                  Latest Deployment
                </Typography>
                <Divider style={{ margin: '12px 0' }} />

                <LabeledRow label="Version" value={data.latest?.version ?? '—'} />
                <LabeledRow label="Recipe" value={data.latest?.recipeId ?? '—'} />
                <LabeledRow label="Updated At" value={fmt(data.latest?.updatedAt)} />
              </Box>
            </Grid>
          </Grid>
        )}

        <Box className={classes.footer}>
          <Button
            variant="outlined"
            size="small"
            component={Link as any}
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View raw status
          </Button>
        </Box>
      </Box>
    </InfoCard>
  );
};

