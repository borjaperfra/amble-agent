import { notFound } from 'next/navigation'
import { isUserZero } from '@/lib/features'
import { getOpportunityLabViewModel } from '@/lib/opportunity-view'
import { resumeQueue } from '@/lib/pipeline/jobs'
import OpportunityZeroLab from '@/components/opportunityzero/OpportunityZeroLab'

export const dynamic = 'force-dynamic'

export default function OpportunityZeroPage() {
  if (!isUserZero() || process.env.NODE_ENV === 'production') notFound()
  // Whatever brought this process up, anything left half-read gets picked up
  // before the page describes the state of the world.
  resumeQueue()
  return <OpportunityZeroLab initial={getOpportunityLabViewModel()} />
}
