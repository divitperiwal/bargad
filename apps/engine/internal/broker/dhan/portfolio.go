package dhan

import (
	"context"
	"fmt"
	"net/http"

	"bargad/engine/internal/broker"
)

type holding struct {
	TradingSymbol string        `json:"tradingSymbol"`
	ISIN          string        `json:"isin"`
	TotalQty      broker.Number `json:"totalQty"`
	AvgCostPrice  broker.Number `json:"avgCostPrice"`
}

func (c *Client) Holdings(ctx context.Context, s broker.Session) ([]broker.Holding, error) {
	var list []holding
	if err := c.do(ctx, s, http.MethodGet, c.baseURL+"/holdings", nil, &list); err != nil {
		return nil, err
	}
	out := make([]broker.Holding, 0, len(list))
	for _, h := range list {
		out = append(out, broker.Holding{
			ISIN:         h.ISIN,
			Symbol:       h.TradingSymbol,
			Quantity:     h.TotalQty.Int(),
			AvgCostPaise: broker.Paise(h.AvgCostPrice.Float()),
		})
	}
	return out, nil
}

type ltpResponse struct {
	Data map[string]map[string]struct {
		LastPrice broker.Number `json:"last_price"`
	} `json:"data"`
}

func (c *Client) LastPrice(ctx context.Context, s broker.Session, inst broker.Instrument) (int64, error) {
	prices, err := c.LastPrices(ctx, s, []broker.Instrument{inst})
	if err != nil {
		return 0, err
	}
	p, ok := prices[inst.BrokerID]
	if !ok {
		return 0, fmt.Errorf("dhan: no price for %s", inst.BrokerID)
	}
	return p, nil
}

// LastPrices quotes every instrument in one request, grouped by exchange segment.
func (c *Client) LastPrices(ctx context.Context, s broker.Session, insts []broker.Instrument) (map[string]int64, error) {
	body := map[string][]int64{}
	for _, inst := range insts {
		id, err := securityID(inst.BrokerID)
		if err != nil {
			return nil, fmt.Errorf("dhan security id %q: %w", inst.BrokerID, err)
		}
		seg := segment(inst.Exchange)
		body[seg] = append(body[seg], id)
	}

	var out ltpResponse
	if err := c.do(ctx, s, http.MethodPost, c.baseURL+"/marketfeed/ltp", body, &out); err != nil {
		return nil, err
	}
	prices := make(map[string]int64, len(insts))
	for _, quotes := range out.Data {
		for id, q := range quotes {
			if q.LastPrice > 0 {
				prices[id] = broker.Paise(q.LastPrice.Float())
			}
		}
	}
	return prices, nil
}
