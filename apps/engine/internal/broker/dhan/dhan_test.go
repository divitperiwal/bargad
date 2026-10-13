package dhan

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"bargad/engine/internal/broker"
)

// Fixtures follow https://dhanhq.co/docs/v2/ (orders, portfolio, market-quote, annexure).

func newClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return New(srv.URL, srv.URL, time.Now)
}

var session = broker.Session{ClientID: "1000000001", Token: "jwt"}

func TestPlaceOrderSendsLimitCNCWithShortCorrelationID(t *testing.T) {
	tag := uuid.NewString()
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/orders" {
			t.Errorf("got %s %s, want POST /orders", r.Method, r.URL.Path)
		}
		if r.Header.Get("access-token") != "jwt" {
			t.Error("missing access-token header")
		}
		var body placeRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.CorrelationID) > 30 {
			t.Errorf("correlationId is %d chars; Dhan allows 30", len(body.CorrelationID))
		}
		if body.CorrelationID != correlationID(tag) || body.OrderType != "LIMIT" || body.ProductType != "CNC" ||
			body.ExchangeSegment != "NSE_EQ" || body.Validity != "DAY" || body.TransactionType != "BUY" ||
			body.SecurityID != "1594" || body.Quantity != 3 || body.Price != 1512.35 {
			t.Errorf("unexpected body: %+v", body)
		}
		_, _ = w.Write([]byte(`{"orderId":"112111182198","orderStatus":"PENDING"}`))
	})

	st, err := c.PlaceOrder(context.Background(), session, broker.OrderRequest{
		Tag: tag, Side: broker.Buy, Quantity: 3, LimitPaise: 151235,
		Instrument: broker.Instrument{BrokerID: "1594", Exchange: "NSE", Symbol: "INFY"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if st.BrokerOrderID != "112111182198" || st.State != broker.StateOpen {
		t.Errorf("status = %+v", st)
	}
}

func TestFindOrderUsesTheSameCorrelationID(t *testing.T) {
	tag := uuid.NewString()
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if want := "/orders/external/" + correlationID(tag); r.URL.Path != want {
			t.Errorf("path %s, want %s", r.URL.Path, want)
		}
		// Quoted numbers, as some doc examples show.
		_, _ = w.Write([]byte(`{"orderId":"9","orderStatus":"PART_TRADED","filledQty":"2","averageTradedPrice":"1510.5"}`))
	})
	st, err := c.FindOrder(context.Background(), session, tag)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != broker.StatePartial || st.FilledQty != 2 || st.AvgFillPaise != 151050 {
		t.Errorf("status = %+v", st)
	}
}

func TestLastPricesBatchesBySegment(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("client-id") != session.ClientID {
			t.Error("market quote needs the client-id header")
		}
		var body map[string][]int64
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["NSE_EQ"]) != 2 || len(body["BSE_EQ"]) != 1 {
			t.Errorf("body = %v", body)
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{
			"NSE_EQ":{"1594":{"last_price":1512.35},"2885":{"last_price":"1300"}},
			"BSE_EQ":{"500325":{"last_price":1299.9}}}}`))
	})
	prices, err := c.LastPrices(context.Background(), session, []broker.Instrument{
		{BrokerID: "1594", Exchange: "NSE"}, {BrokerID: "2885", Exchange: "NSE"}, {BrokerID: "500325", Exchange: "BSE"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{"1594": 151235, "2885": 130000, "500325": 129990}
	for id, p := range want {
		if prices[id] != p {
			t.Errorf("price[%s] = %d, want %d", id, prices[id], p)
		}
	}
}

func TestErrorCodesAreClassified(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		body     string
		session  bool
		rejected bool
	}{
		{"401", 401, `{}`, true, false},
		{"DH-901 invalid token", 400, `{"errorType":"Invalid_Authentication","errorCode":"DH-901","errorMessage":"expired"}`, true, false},
		{"807 data api token expired", 400, `{"status":"failed","data":{"807":"Access token is expired"}}`, true, false},
		{"DH-904 rate limit", 400, `{"errorCode":"DH-904","errorMessage":"Too many requests"}`, false, false},
		{"DH-906 order error", 400, `{"errorCode":"DH-906","errorMessage":"Insufficient funds"}`, false, true},
		{"500", 500, `oops`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			})
			_, err := c.PlaceOrder(context.Background(), session, broker.OrderRequest{
				Tag: uuid.NewString(), Side: broker.Sell, Quantity: 1, LimitPaise: 100,
				Instrument: broker.Instrument{BrokerID: "1", Exchange: "NSE"},
			})
			var rejected *broker.RejectedError
			if got := errors.Is(err, broker.ErrSessionExpired); got != tc.session {
				t.Errorf("session expired = %v, want %v (err %v)", got, tc.session, err)
			}
			if got := errors.As(err, &rejected); got != tc.rejected {
				t.Errorf("rejected = %v, want %v (err %v)", got, tc.rejected, err)
			}
		})
	}
}

func TestLoginGeneratesTokenFromPINAndTOTP(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.URL.Path != "/app/generateAccessToken" || q.Get("dhanClientId") != "1000000001" ||
			q.Get("pin") != "123456" || len(q.Get("totp")) != 6 {
			t.Errorf("unexpected login request %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"dhanClientId":"1000000001","accessToken":"jwt","expiryTime":"2026-11-19T09:00:00.000"}`))
	})
	s, err := c.Login(context.Background(), "1000000001", broker.Credentials{PIN: "123456", TOTPSecret: "JBSWY3DPEHPK3PXP"})
	if err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 19, 9, 0, 0, 0, ist); s.Token != "jwt" || !s.ExpiresAt.Equal(want) {
		t.Errorf("session = %+v", s)
	}
}
