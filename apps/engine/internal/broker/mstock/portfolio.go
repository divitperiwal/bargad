package mstock

import (
	"context"
	"fmt"
	"net/http"
	"net/url"

	"bargad/engine/internal/broker"
)

type holding struct {
	TradingSymbol string        `json:"tradingsymbol"`
	ISIN          string        `json:"isin"`
	Quantity      broker.Number `json:"quantity"`
	AveragePrice  broker.Number `json:"average_price"`
}

func (c *Client) Holdings(ctx context.Context, s broker.Session) ([]broker.Holding, error) {
	var list []holding
	if err := c.do(ctx, s, http.MethodGet, "/portfolio/holdings", nil, &list); err != nil {
		return nil, err
	}
	out := make([]broker.Holding, 0, len(list))
	for _, h := range list {
		out = append(out, broker.Holding{
			ISIN:         h.ISIN,
			Symbol:       h.TradingSymbol,
			Quantity:     h.Quantity.Int(),
			AvgCostPaise: broker.Paise(h.AveragePrice.Float()),
		})
	}
	return out, nil
}

func (c *Client) LastPrice(ctx context.Context, s broker.Session, inst broker.Instrument) (int64, error) {
	prices, err := c.LastPrices(ctx, s, []broker.Instrument{inst})
	if err != nil {
		return 0, err
	}
	p, ok := prices[inst.BrokerID]
	if !ok {
		return 0, fmt.Errorf("mstock: no price for %s:%s", inst.Exchange, inst.BrokerID)
	}
	return p, nil
}

// LastPrices quotes every instrument in one request (one i=EXCHANGE:SYMBOL each).
func (c *Client) LastPrices(ctx context.Context, s broker.Session, insts []broker.Instrument) (map[string]int64, error) {
	q := url.Values{}
	byKey := make(map[string]string, len(insts)) // "NSE:INFY" → broker id
	for _, inst := range insts {
		key := inst.Exchange + ":" + inst.BrokerID // mStock's own symbol: NSE:ACC-EQ
		q.Add("i", key)
		byKey[key] = inst.BrokerID
	}

	var out map[string]struct {
		LastPrice broker.Number `json:"last_price"`
	}
	if err := c.do(ctx, s, http.MethodGet, "/instruments/quote/ltp", q, &out); err != nil {
		return nil, err
	}
	prices := make(map[string]int64, len(out))
	for key, quote := range out {
		if id, ok := byKey[key]; ok && quote.LastPrice > 0 {
			prices[id] = broker.Paise(quote.LastPrice.Float())
		}
	}
	return prices, nil
}
