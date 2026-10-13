package mstock

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"bargad/engine/internal/broker"
)

// Fixtures follow https://tradingapi.mstock.com/docs/v1/typeA/ (User, Orders, Portfolio, market quote).

func newClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return New(srv.URL, "apikey", time.Now)
}

var session = broker.Session{ClientID: "MA0001", Token: "tok"}

func TestPlaceOrderSendsDocumentedForm(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/orders/regular" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "token apikey:tok" || r.Header.Get("X-Mirae-Version") != "1" {
			t.Errorf("headers = %v", r.Header)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		want := map[string]string{
			"tradingsymbol": "INFY-EQ", "exchange": "NSE", "transaction_type": "SELL", "order_type": "LIMIT",
			"product": "CNC", "validity": "DAY", "quantity": "4", "price": "1500.05", "tag": "t-1",
		}
		for k, v := range want {
			if got := r.PostForm.Get(k); got != v {
				t.Errorf("%s = %q, want %q", k, got, v)
			}
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"order_id":"1131241001100"}}`))
	})
	st, err := c.PlaceOrder(context.Background(), session, broker.OrderRequest{
		Tag: "t-1", Side: broker.Sell, Quantity: 4, LimitPaise: 150005,
		Instrument: broker.Instrument{BrokerID: "INFY-EQ", Exchange: "NSE", Symbol: "INFY"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if st.BrokerOrderID != "1131241001100" || st.State != broker.StateOpen {
		t.Errorf("status = %+v", st)
	}
}

func TestOrderBookToleratesTagShapes(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":[
			{"order_id":"1","status":"Pending","tag":null,"filled_quantity":0,"average_price":0},
			{"order_id":"2","status":"Rejected","tag":[],"status_message":"RMS: margin exceeds"},
			{"order_id":"3","status":"COMPLETE","tag":"ours","filled_quantity":"4","average_price":"1500.05"}]}`))
	})
	ctx := context.Background()

	st, err := c.FindOrder(ctx, session, "ours")
	if err != nil {
		t.Fatal(err)
	}
	if st.BrokerOrderID != "3" || st.State != broker.StateFilled || st.FilledQty != 4 || st.AvgFillPaise != 150005 {
		t.Errorf("found = %+v", st)
	}
	st, err = c.GetOrder(ctx, session, "2")
	if err != nil {
		t.Fatal(err)
	}
	if st.State != broker.StateRejected || st.RejectReason == "" {
		t.Errorf("rejected order = %+v", st)
	}
	if _, err := c.FindOrder(ctx, session, "missing"); !errors.Is(err, broker.ErrOrderNotFound) {
		t.Errorf("err = %v, want ErrOrderNotFound", err)
	}
}

func TestLastPricesRepeatsTheIParameter(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query()["i"]; len(got) != 2 || got[0] != "NSE:ACC-EQ" {
			t.Errorf("i = %v", got)
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{
			"NSE:ACC-EQ":{"instrument_token":22,"last_price":1373.3},
			"BSE:ACC-A":{"instrument_token":5633,"last_price":1373.15}}}`))
	})
	prices, err := c.LastPrices(context.Background(), session, []broker.Instrument{
		{BrokerID: "ACC-EQ", Exchange: "NSE"}, {BrokerID: "ACC-A", Exchange: "BSE"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if prices["ACC-EQ"] != 137330 || prices["ACC-A"] != 137315 {
		t.Errorf("prices = %v", prices)
	}
}

func TestErrorsAreClassified(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		body     string
		session  bool
		rejected bool
	}{
		{"token exception", 401, `{"status":"error","message":"Invalid request. Please try again.","error_type":"TokenException","data":null}`, true, false},
		{"token exception as 400", 400, `{"status":"error","error_type":"TokenException"}`, true, false},
		{"api key exception", 403, `{"status":"error","message":"Subscription expired","error_type":"APIKeyException"}`, false, false},
		{"input exception on 200", 200, `{"status":"error","message":"Market is closed","error_type":"InputException","data":null}`, false, true},
		{"server error", 502, `bad gateway`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			})
			_, err := c.PlaceOrder(context.Background(), session, broker.OrderRequest{
				Tag: "t", Side: broker.Buy, Quantity: 1, LimitPaise: 100,
				Instrument: broker.Instrument{BrokerID: "INFY-EQ", Exchange: "NSE"},
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

func TestLoginVerifiesTOTP(t *testing.T) {
	c := newClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.URL.Path != "/session/verifytotp" || r.PostForm.Get("api_key") != "apikey" || len(r.PostForm.Get("totp")) != 6 {
			t.Errorf("unexpected login %s %v", r.URL.Path, r.PostForm)
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"access_token":"tok","user_id":"MA0001"}}`))
	})
	s, err := c.Login(context.Background(), "MA0001", broker.Credentials{TOTPSecret: "JBSWY3DPEHPK3PXP"})
	if err != nil {
		t.Fatal(err)
	}
	if s.Token != "tok" || s.ExpiresAt.In(ist).Hour() != 0 {
		t.Errorf("session = %+v", s)
	}
}
